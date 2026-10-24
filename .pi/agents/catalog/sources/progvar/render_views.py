#!/usr/bin/env python3
"""Render nav.json into navigate.html (clickable) and progvar-index.md (Obsidian)."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
nav = json.load(open(os.path.join(HERE, "nav.json"), encoding="utf-8"))

TOPICS = [{"topic": t["topic"], "sets": t["sets"]} for t in nav["topics"]]
if nav["unclassified_sets"]:
    TOPICS.append({"topic": "Not topic-classified on progvar.fun", "sets": nav["unclassified_sets"]})

# ---------------- markdown ----------------
L = ["# progvar.fun — problem index", "",
     f"Mirrors the site's own navigation: **topic → set title → problems**. "
     f"Fetched {nav['fetched']}. Problems the site cannot reach by clicking are excluded.", ""]
for t in TOPICS:
    n = sum(len(s["problems"]) for s in t["sets"])
    L.append(f"## {t['topic']}")
    L.append("")
    L.append(f"*{len(t['sets'])} sets · {n} problems*")
    L.append("")
    for s in t["sets"]:
        L.append(f"### {s['title']}")
        L.append("")
        if not s["problems"]:
            L.append("*no problems in this set*"); L.append(""); continue
        for p in s["problems"]:
            dacu = f" · DACU {p['dacu']}" if p["dacu"] else ""
            L.append(f"{p['number']}. [{p['name']}]({p['url']}){dacu}")
        L.append("")
open(os.path.join(HERE, "progvar-index.md"), "w", encoding="utf-8").write("\n".join(L))

# ---------------- html ----------------
data = json.dumps(TOPICS, ensure_ascii=False)
html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>progvar.fun problem index</title>
<style>
 :root{--bd:#d8d8d8;--mut:#777;--acc:#3b6ea5}
 *{box-sizing:border-box}
 body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c1c1c}
 #wrap{display:flex;min-height:100vh}
 #side{width:310px;flex:0 0 310px;border-right:1px solid var(--bd);padding:16px;overflow:auto;height:100vh;position:sticky;top:0;background:#fafafa}
 #side h1{font-size:15px;margin:0 0 2px}
 #side .sub{font-size:12px;color:var(--mut);margin-bottom:14px}
 .tp{padding:6px 8px;border-radius:5px;cursor:pointer;font-size:14px}
 .tp:hover{background:#ececec}
 .tp.on{background:var(--acc);color:#fff}
 .tp small{color:var(--mut)} .tp.on small{color:#dbe7f5}
 #main{padding:22px 28px;flex:1;max-width:1100px}
 .crumb{font-size:13px;color:var(--mut);margin-bottom:10px}
 h2{font-size:21px;margin:.2em 0 .6em}
 table{border-collapse:collapse;width:100%;font-size:14px}
 th,td{border-bottom:1px solid #eee;padding:7px 9px;text-align:left}
 th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);font-weight:600}
 td.n{color:var(--mut);width:44px} td.c{width:110px;text-align:right;color:var(--mut)}
 a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
 .setrow{cursor:pointer} .setrow:hover{background:#f6f9fc}
 .badge{font-size:11px;color:var(--mut)}
 .empty{color:var(--mut);font-style:italic}
</style></head><body>
<div id="wrap">
 <div id="side">
  <h1>progvar.fun</h1>
  <div class="sub">topic &rarr; set &rarr; problems</div>
  <div id="topics"></div>
 </div>
 <div id="main"></div>
</div>
<script>
const DATA = __DATA__;
const SIDE = document.getElementById('topics'), MAIN = document.getElementById('main');
let curTopic = -1, curSet = -1;
function renderSide(){
  SIDE.innerHTML = DATA.map((t,i)=>{
    const n = t.sets.reduce((a,s)=>a+s.problems.length,0);
    return `<div class="tp ${i===curTopic?'on':''}" data-i="${i}">${t.topic}<br><small>${t.sets.length} sets · ${n} problems</small></div>`;
  }).join('');
  SIDE.querySelectorAll('.tp').forEach(e=>e.onclick=()=>{curTopic=+e.dataset.i;curSet=-1;renderSide();renderSets();});
}
function renderSets(){
  if(curTopic<0){ MAIN.innerHTML = '<div class="crumb">pick a topic</div><h2>progvar.fun problem sets</h2><p>Choose a topic on the left.</p>'; return; }
  const t = DATA[curTopic];
  MAIN.innerHTML = `<div class="crumb">progvar.fun</div><h2>${t.topic}</h2>
   <table><thead><tr><th>Set</th><th class="c">Problems</th></tr></thead><tbody>
   ${t.sets.map((s,i)=>`<tr class="setrow" data-i="${i}"><td>${s.title}${s.problems.length?'':' <span class="badge">(empty)</span>'}</td><td class="c">${s.problems.length}</td></tr>`).join('')}
   </tbody></table>`;
  MAIN.querySelectorAll('.setrow').forEach(e=>e.onclick=()=>{curSet=+e.dataset.i;renderProblems();});
}
function renderProblems(){
  const t = DATA[curTopic], s = t.sets[curSet];
  MAIN.innerHTML = `<div class="crumb"><a href="#" id="bk">${t.topic}</a> &rsaquo; ${s.title}</div>
   <h2>${s.title}</h2>
   <table><thead><tr><th class="n">#</th><th>Problem</th><th class="c">Global DACU</th><th class="c">Group DACU</th></tr></thead><tbody>
   ${s.problems.map(p=>`<tr><td class="n">${p.number}</td><td><a href="${p.url}" target="_blank" rel="noopener">${p.name}</a></td><td class="c">${p.solved_count||'—'}</td><td class="c">${p.dacu||'—'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">no problems</td></tr>'}
   </tbody></table>`;
  document.getElementById('bk').onclick=e=>{e.preventDefault();renderSets();};
}
renderSide(); renderSets();
</script></body></html>"""
open(os.path.join(HERE, "navigate.html"), "w", encoding="utf-8").write(html.replace("__DATA__", data))

md = os.path.getsize(os.path.join(HERE, "progvar-index.md"))
print(f"wrote progvar-index.md ({md//1024} KB) and navigate.html")
