package com.aichat.chat;

import java.util.List;

/**
 * 前端请求体：
 * <pre>
 * {
 *   "messages": [{ "role": "user", "content": "..." }],
 *   "modelConfig": {
 *     "modelId": "deepseek-chat",
 *     "baseUrl": "https://api.deepseek.com/v1",
 *     "apiKey": "sk-...",
 *     "useFullUrl": false
 *   }
 * }
 * </pre>
 *
 * `modelConfig` 可选：
 * - 带：按配置动态连接目标服务（企业级「供应商 + 地址 + Key + 模型 ID」模型）。
 * - 不带：回退到 application.yml 里的默认模型（本地 Bionic）。
 *
 * `model`（旧字段）已废弃，保留仅作向后兼容；优先使用 modelConfig。
 */
public record ChatRequest(List<Message> messages, String model, ModelConfig modelConfig) {

    public record Message(String role, String content) {
    }

    /**
     * 完整模型配置（对齐前端「自定义模型」四件套）。
     *
     * @param modelId    请求体里的 model 字段
     * @param baseUrl    服务根地址（OpenAI 兼容），为空则用后端默认
     * @param apiKey     可选 Bearer 鉴权
     * @param useFullUrl true 表示 baseUrl 已是完整 chat 地址，不再拼 /chat/completions
     */
    public record ModelConfig(String modelId, String baseUrl, String apiKey, Boolean useFullUrl) {
    }
}
