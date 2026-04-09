# POI Profile Encoder Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 `poi-level` 代表点特征编码接入 V4 `area_overview` 主链，让回答不仅知道片区像什么，也知道哪些代表点在支撑这个判断。

**Architecture:** 在 `spatial_encoder` 新增 `encode_poi_profile` action，输入为代表 POI 的结构化档案。`GeoLoomAgent` 在 `area_overview` 已有 `representativeSamples` 的基础上，自动抽取 2-3 个关键样本做 poi-level 编码，把“交通接驳点 / 校园高频消费点 / 日常配套支点”这类角色标签写回 `EvidenceView`，供 renderer / synthesis 消费。

**Tech Stack:** TypeScript, Vitest, Fastify agent loop, local/remote Python bridge fallback.

---
