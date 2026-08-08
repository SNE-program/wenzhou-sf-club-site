// ============================================
// 在校名册导入脚本（途径一）
// 输入：学校提供的 CSV（学号,姓名[,班级]），UTF-8，首行可含表头（自动跳过）
// 输出：仅把「哈希 + 脱敏掩码 + 姓名」写入 student_roster；明文学号不落库、不打日志
// 安全要求：导入完成后立即删除源 CSV 文件
// 用法：
//   node scripts/import-roster.mjs <postgres连接串> <名册.csv>
// ============================================
import { readFileSync } from "node:fs";
import pg from "pg";

const [, , conn, csvPath] = process.argv;
if (!conn || !csvPath) {
  console.error("用法: node scripts/import-roster.mjs <postgres连接串> <名册.csv>");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("已连接数据库");

const lines = readFileSync(csvPath, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

let imported = 0;
let skipped = 0;
for (const line of lines) {
  const parts = line.split(",").map((s) => s.trim());
  const sid = parts[0] || "";
  const name = parts[1] || "";
  const gradeClass = parts[2] || null;

  // 跳过表头行与非法行（学号应为纯数字）
  if (!sid || !name || !/^\d+$/.test(sid)) {
    skipped++;
    continue;
  }

  const mask = sid.length <= 4 ? sid : sid.slice(0, 2) + "****" + sid.slice(-2);

  try {
    await client.query(
      `INSERT INTO public.student_roster (student_hash, display_mask, name, grade_class)
       VALUES (crypt($1, gen_salt('bf')), $2, $3, $4)`,
      [sid, mask, name, gradeClass]
    );
    imported++;
  } catch (e) {
    // 唯一约束冲突 = 已导入过，跳过
    if (e.code === "23505") skipped++;
    else throw e;
  }
}

console.log(`导入完成：成功 ${imported} 行，跳过 ${skipped} 行`);
console.log("安全提示：学号仅以不可逆哈希入库，请立即删除源 CSV 文件。");
await client.end();
