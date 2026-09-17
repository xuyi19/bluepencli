// ──────────────────────────────────────────────────────────────
// 蓝笔申论 BluePencil · 作者 许一 <xuconghui_03@qq.com>
// GitHub: https://github.com/xuyi19/bluepencli
// Gitee : https://gitee.com/xuyi_19/bluepencil
// 许可: AGPL-3.0 · 转发或修改请保留本署名
// ──────────────────────────────────────────────────────────────
// 题库包验签公钥。**由 .tools/exams/bpq-keygen.mjs 写入，不要手改。**
//
// 这是**公钥**，可以公开：它只能验证"包是不是用对应私钥签的"，签不出包来。
// 对应的私钥在作者本机的 .tools/exams/keys/ 下（已 gitignore，永远不要提交）。
//
// 为什么是数组：换密钥时把新公钥**追加**进来，不要删旧的 ——
// 删掉哪一把，之前发出去的包就再也验不过签了（那些包用户手上还在用）。
export const BPQ_PUBLIC_KEYS = [
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEpSEUXMpvRPGjWekAOFm/lqaDNNwejocbmklzl4dt7ihqwOLKS2e7VcGIyKtYyeU2Ln79VxADmahmmjd/WK5rMw==",
]
