// ============================================
// 域名解析状态自动检测脚本
// 用法：
//   node scripts/check-domain.mjs            # 每 5 分钟检查一次，直到成功
//   node scripts/check-domain.mjs --once     # 只检查一次（用于手动自查）
//   node scripts/check-domain.mjs --interval 300 --once
// 成功判定：wzmssf.club 解析到 GitHub Pages 的 IP（185.199.x.x）
// ============================================
import { execFileSync } from "node:child_process";

const DOMAIN = "wzmssf.club";
const SERVERS = ["8.8.8.8", "223.5.5.5", "114.114.114.114"]; // Google / 阿里 / 114
const argOf = (name, dft) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dft;
};
const INTERVAL_MS = argOf("--interval", 300) * 1000; // 默认 300 秒
const ONCE = process.argv.includes("--once");
const isGitHubPagesIp = (ip) => /^185\.199\.\d+\.\d+$/.test(ip);

/** 向指定 DNS 服务器查询 A 记录，返回 IP 数组（查询失败返回 null） */
function query(server) {
  try {
    const out = execFileSync("nslookup", ["-type=A", DOMAIN, server], {
      encoding: "utf8",
      timeout: 15000,
    });
    // 只取 "Name:" 之后的结果区，排除 nslookup 顶部的服务器地址
    const idx = out.indexOf("Name:");
    if (idx < 0) return []; // 未找到查询结果（域名未解析/查询失败）
    return [...out.slice(idx).matchAll(/Address:\s+(\d+\.\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  } catch {
    return null;
  }
}

function checkOnce() {
  const now = new Date().toLocaleString("zh-CN", { hour12: false });
  const parts = [];
  let ok = false;
  for (const s of SERVERS) {
    const ips = query(s);
    if (ips && ips.length) {
      const good = ips.filter(isGitHubPagesIp);
      parts.push(`${s} → ${ips.join(", ")}${good.length ? " ✓" : ""}`);
      if (good.length) ok = true;
    } else {
      parts.push(`${s} → 未解析`);
    }
  }
  console.log(`[${now}] ${parts.join("  |  ")}`);
  return ok;
}

console.log(`开始检查 ${DOMAIN} 的全球 DNS 解析状态`);
console.log(ONCE ? "单次模式。" : `每 ${INTERVAL_MS / 60000} 分钟自动重试，直到解析成功（Ctrl+C 停止）。`);
console.log("");

let count = 0;
(async function loop() {
  count++;
  if (checkOnce()) {
    console.log("");
    console.log(`✅ 域名已全球解析成功（命中 GitHub Pages IP）。`);
    console.log(`   接下来等 GitHub 自动签发 HTTPS 证书（通常 10 分钟内完成）。`);
    console.log(`   之后在浏览器打开 https://${DOMAIN} 即可访问网站。`);
    console.log(`   旧地址 sne-program.github.io/wenzhou-sf-club-site 会自动跳转到新域名。`);
    process.exit(0);
  }
  if (ONCE) {
    console.log("尚未生效。");
    process.exit(1);
  }
  console.log(`  第 ${count} 次未生效，${INTERVAL_MS / 60000} 分钟后重试……`);
  console.log("");
  setTimeout(loop, INTERVAL_MS);
})();
