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
import java.util.stream.Stream;

/** 调本地模型（OpenAI 兼容），把流式增量抛给回调。 */
@Component
public class ModelClient {

    private static final Logger log = LoggerFactory.getLogger(ModelClient.class);

    /** reasoning 与 text 分开回调，前端据此渲染思考区 */
    public interface DeltaHandler {
        void onDelta(String reasoning, String text);
    }

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
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("model", model);
        payload.put("stream", true);
        payload.put("temperature", temperature);
        payload.put("messages", messages.stream()
                .map(message -> Map.of("role", message.role(), "content", message.content()))
                .toList());

        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
                    .timeout(Duration.ofMinutes(5))
                    .header("Content-Type", "application/json")
                    .header("Accept", "text/event-stream")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
                    .build();
        } catch (Exception e) {
            throw new IllegalStateException("构造模型请求失败", e);
        }

        HttpResponse<Stream<String>> response;
        try {
            response = http.send(request, HttpResponse.BodyHandlers.ofLines());
        } catch (IOException e) {
            throw new UncheckedIOException("调用本地模型失败：" + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("调用本地模型被中断", e);
        }

        if (response.statusCode() != 200) {
            throw new IllegalStateException("本地模型返回 " + response.statusCode());
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
}
