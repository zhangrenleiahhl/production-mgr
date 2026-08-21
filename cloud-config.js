// ============================================================
//  云端同步配置（Supabase）
//  警告：必须把下面 url / key 两行改成你的真实值，不能只写在注释里！
//  如果保留 "YOUR-PROJECT-REF" 或 "YOUR-ANON-PUBLIC-KEY"，页面会显示"未配置云端"。
//
//  正确示例（url 不要带 /rest/v1/，Supabase 库会自动加）：
//    url: "https://zxnxvbghsfwsikyncbus.supabase.co",
//    key: "sb_publishable_oig7ufDCFZfh_L8z8fV0sw_CZfMc-c3"
//
//  获取步骤见同目录《云端同步配置说明.txt》。
//  没配置时，页面自动降级为纯本地存储，照常能用。
// ============================================================
window.CLOUD_CONFIG = {
  // ⚠ 改这里：Project URL（一定是 https://...supabase.co，不要 /rest/v1/）
  url: "https://zxnxvbghsfwsikyncbus.supabase.co",
  // ⚠ 改这里：anon public key（Supabase API 设置里复制完整的一串）
  key: "sb_publishable_oig7ufDCFZfh_L8z8fV0sw_CZfMc-c3"
};
