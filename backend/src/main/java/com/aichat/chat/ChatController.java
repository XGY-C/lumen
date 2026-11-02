package com.aichat.chat;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * POST /api/chat
 *
 * 前端请求：{ "messages": [{ "role": "user", "content": "..." }] }
 * 响应帧：  data: {"type":"reasoning"|"text","delta":"..."} … data: [DONE]
 */
@RestController
@RequestMapping("/api")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final ModelClient model;
    private final ObjectMapper mapper = new ObjectMapper();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public ChatController(ModelClient model) {
        this.model = model;
    }

    @PostMapping(value = "/chat", produces = "text/event-stream;charset=UTF-8")
    public SseEmitter chat(@RequestBody ChatRequest request) {
        // 0 = 不超时，长回答不会被容器掐断
        SseEmitter emitter = new SseEmitter(0L);
        List<ChatRequest.Message> messages =
                request.messages() == null ? List.of() : request.messages();

        emitter.onTimeout(emitter::complete);
        emitter.onError(e -> log.debug("sse 连接异常: {}", e.getMessage()));

        executor.submit(() -> {
            try {
                model.stream(messages, (reasoning, text) -> {
                    try {
                        if (!reasoning.isEmpty()) {
                            emitter.send(SseEmitter.event().data(frame("reasoning", reasoning)));
                        }
                        if (!text.isEmpty()) {
                            emitter.send(SseEmitter.event().data(frame("text", text)));
                        }
                    } catch (IOException e) {
                        throw new UncheckedIOException(e);
                    }
                });

                emitter.send(SseEmitter.event().data("[DONE]"));
                emitter.complete();
            } catch (UncheckedIOException e) {
                // 前端点了停止，连接已关，静默收尾
                log.debug("客户端已断开: {}", e.getMessage());
                emitter.complete();
            } catch (Exception e) {
                log.warn("对话失败: {}", e.getMessage());
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    private String frame(String type, String delta) throws IOException {
        return mapper.writeValueAsString(Map.of("type", type, "delta", delta));
    }
}
