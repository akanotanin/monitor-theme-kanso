#!/bin/bash
# 最终护栏复跑：一个个跑（每个都要起 headless Chrome，连着跑会抢端口），结果汇总到一个文件。
# 用法：bash tools/sweep_final.sh（跑完看 shots/sweep-final.txt）
cd "$(dirname "$0")/.." || exit 1
OUT="shots/sweep-final.txt"
: > "$OUT"
# verify_icons / verify_farm_entry 默认都要 5199：本机只要别的会话留着一个 serve 占着它，
# 这两支就 EADDRINUSE 直接退出、连摘要行都不打 —— sweep 里只显示「没抓到结果行」这种静默假红。
# 统一给它们错开端口（两支各自认 FARM_PORT / ICON_PORT）。残留 serve 占着 5199 时先杀掉再判真红假红。
export FARM_PORT=5899 ICON_PORT=5898
for t in verify_appearance verify_icons verify_touch_targets verify_footer_credit \
         verify_search verify_detail_charts verify_title verify_farm_entry \
         verify_card_form \
         verify_latency_min_span verify_detail_remarks verify_detail_preload \
         verify_offline_last verify_offline_time verify_visibility verify_hub141; do
  line=$(node "tools/$t.mjs" 2>&1 | grep -E "[0-9]+ PASS / [0-9]+ FAIL|ALL PASS|[0-9]+ 条通过|[0-9]+ 个视角通过|PASS [0-9]+ / FAIL [0-9]+|全部通过|FAIL [0-9]+ 条" | tail -1)
  printf "%-26s %s\n" "$t" "${line:-（没抓到结果行，得单独看）}" | tee -a "$OUT"
  sleep 2
done
# 注：① verify_latency_range / verify_detail_preload 需要活的站点（本机隧道 / 上游 hub）与各自参数，
#       裸跑必然「没抓到结果行」——跑真机时单独指定（用法见各工具头部）：
#         ssh -N -L 28085:127.0.0.1:28080 <hub 那台机器>
#         node tools/verify_detail_preload.mjs http://127.0.0.1:28085     # kanso dist + 真 hub 数据
#     ② verify_settings_dialog（验证后台「没有主题设置入口」）需要 `<theme.json> <前缀> <hub隧道地址>`
#        三个参数，同样不在这份裸跑清单里；拿带 config 的旧 theme.json 跑时那边应当 FAIL（对照组）：
#         node tools/verify_settings_dialog.mjs theme.json shots/settings-dialog-kanso http://127.0.0.1:28085
echo "===== 跑完 =====" >> "$OUT"
