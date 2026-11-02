package com.aichat.chat;

import java.util.List;

/** 前端请求体：{ "messages": [{ "role": "user", "content": "..." }] } */
public record ChatRequest(List<Message> messages) {

    public record Message(String role, String content) {
    }
}
