package com.aichat.chat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 调模型服务（OpenAI 兼容），把流式增量抛给回调。
 *
 * 支持两种模式：
 * 1. 默认模式：用 application.yml 里的 base-url / model（本地 Bionic）。
 * 2. 动态模式：请求带 modelConfig 时，按配置的 baseUrl / apiKey / modelId 连接
 *    目标服务（企业级「供应商 + 地址 + Key + 模型」模型）。
 *
 * 动态模式有地址白名单校验，防止 SSRF：只允许本地回环 + 内置预设域名。
 */
@Component
public class ModelClient {

    private static final Logger log = LoggerFactory.getLogger(ModelClient.class);

    /** reasoning 与 text 分开回调，前端据此渲染思考区 */
    public interface DeltaHandler {
        void onDelta(String reasoning, String text);
    }

    /**
     * 内置预设供应商域名（OpenAI / DeepSeek / 百炼）。
     * 动态模式只允许这些域名或本地回环，其它地址一律拒绝（防 SSRF）。
     */
    private static final Set<String> ALLOWED_HOSTS = Set.of(
            "api.openai.com",
            "api.deepseek.com",
            "dashscope.aliyuncs.com"
    );

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;
    private final String model;
    private final double temperature;

    public ModelClient(
            @Value("${app.model.base-url}") String baseUrl,
            @Value("${app.model.name}") String model,
            @Value("${app.model.temperature:0.7}") double temperature) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.model = model;
        this.temperature = temperature;
        log.info("model endpoint = {}/chat/completions, model = {}", this.baseUrl, model);
    }

    public void stream(List<ChatRequest.Message> messages, DeltaHandler handler) {
        stream(messages, null, null, handler);
    }

    /**
     * @param modelId 请求里带的模型名（旧字段）；为 null 或空白时回退到 yml 默认值。
     * @param config  完整模型配置；非空时优先级高于 modelId，动态连接目标服务。
     */
    public void stream(List<ChatRequest.Message> messages, String modelId, ChatRequest.ModelConfig config, DeltaHandler handler) {
        // 解析本次请求要用的四元组
        String effectiveModel;
        String effectiveBaseUrl;
        String effectiveApiKey;
        boolean useFullUrl;

        if (config != null && isNotBlank(config.baseUrl())) {
            // 动态模式：按配置连接，地址须过白名单
            effectiveBaseUrl = trimTrailingSlash(config.baseUrl().trim());
            validateHost(effectiveBaseUrl);
            effectiveModel = isNotBlank(config.modelId()) ? config.modelId().trim() : this.model;
            effectiveApiKey = config.apiKey() == null ? "" : config.apiKey().trim();
            useFullUrl = Boolean.TRUE.equals(config.useFullUrl());
        } else {
            // 默认模式：用 yml 配置，modelId 仅覆盖模型名
            effectiveBaseUrl = this.baseUrl;
            effectiveModel = (modelId == null || modelId.isBlank()) ? this.model : modelId.trim();
            effectiveApiKey = "";
            useFullUrl = false;
        }

        String endpoint = useFullUrl ? effectiveBaseUrl : effectiveBaseUrl + "/chat/completions";

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", effectiveModel);
        payload.put("stream", true);
        payload.put("temperature", temperature);
        payload.put("messages", messages.stream()
                .map(message -> Map.of("role", message.role(), "content", message.content()))
                .toList());

        HttpRequest request;
        try {
            var builder = HttpRequest.newBuilder(URI.create(endpoint))
                    .timeout(Duration.ofMinutes(5))
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream");
            if (!effectiveApiKey.isEmpty()) {
                builder.header("Authorization", "Bearer " + effectiveApiKey);
            }
            request = builder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload))).build();
        } catch (Exception e) {
            throw new IllegalStateException("构造模型请求失败", e);
        }

        HttpResponse<Stream<String>> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofLines());
        } catch (IOException e) {
            throw new UncheckedIOException("调用模型服务失败：" + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("调用模型服务被中断", e);
        }

        if (response.statusCode() != 200) {
            throw new IllegalStateException("模型服务返回 " + response.statusCode());
        }

        try (Stream<String> lines = response.body()) {
            var iterator = lines.iterator();
            while (iterator.hasNext()) {
                String line = iterator.next();
                if (line.isBlank() || !line.startsWith("data:")) {
                    continue;
                }

                String data = line.substring("data:".length()).trim();
                if ("[DONE]".equals(data)) {
                    return;
                }

                JsonNode delta = mapper.readTree(data).path("choices").path(0).path("delta");
                String reasoning = delta.path("reasoning_content").asText("");
                String text = delta.path("content").asText("");
                if (!reasoning.isEmpty() || !text.isEmpty()) {
                    handler.onDelta(reasoning, text);
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static boolean isNotBlank(String s) {
        return s != null && !s.isBlank();
    }

    private static String trimTrailingSlash(String s) {
        return s.endsWith("/") ? s.substring(0, s.length() - 1) : s;
    }

    /**
     * 校验目标地址是否在白名单内（本地回环 + 预设域名），防止 SSRF。
     * 不合法时抛异常，由上层转成错误响应。
     */
    private void validateHost(String url) {
        String host;
        try {
            host = URI.create(url).getHost();
        } catch (Exception e) {
            throw new IllegalStateException("模型地址不合法");
        }
        if (host == null) {
            throw new IllegalStateException("模型地址缺少主机名");
        }

        String lower = host.toLowerCase();
        boolean loopback = lower.equals("localhost")
                || lower.equals("127.0.0.1")
                || lower.equals("::1")
                || lower.startsWith("127.")
                || lower.startsWith("10.")
                || lower.startsWith("192.168.")
                || lower.startsWith("169.254.")
                || lower.equals("0.0.0.0");

        if (loopback) return;

        // 允许白名单域名本身或其任意子域
        boolean allowed = ALLOWED_HOSTS.stream()
                .anyMatch(allowedHost -> lower.equals(allowedHost) || lower.endsWith("." + allowedHost));
        if (!allowed) {
            throw new IllegalStateException("模型地址不在允许列表内：" + host);
        }
    }
}
