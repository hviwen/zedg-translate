#!/usr/bin/env python3
"""Build compact vocab JSON files for the hover-translate extension.

Sources:
- GaoZhong_2.json / GaoZhong_3.json (kajweb/dict, 高中/高考3500词, NDJSON)
- CET4_1/2/3.json (kajweb/dict, 大学英语四级, NDJSON)
- Wei-Xia/most-frequent-technology-english-words _posts (计算机词汇, Jekyll posts)

Output shape:
{"name": "...", "source": "...", "words": {"word": {"trans": ["n. 放任"], "phonetic": "/.../"}}}
"""
import json, re, os, glob

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vocab")


def load_ndjson(paths):
    words = {}
    for path in paths:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                word = obj["headWord"].strip().lower()
                content = obj["content"]["word"]["content"]
                trans = []
                for t in content.get("trans", []):
                    pos, cn = t.get("pos", "").strip(), t.get("tranCn", "").strip()
                    if cn:
                        trans.append(f"{pos}. {cn}" if pos else cn)
                old = words.get(word)
                if old:
                    for t in trans:
                        if t not in old["trans"]:
                            old["trans"].append(t)
                    words[word] = {"trans": old["trans"][:4]}
                elif trans:
                    words[word] = {"trans": trans[:4]}
    return words


def load_tech_posts(root):
    words = {}
    for path in glob.glob(os.path.join(root, "_posts", "*.md")):
        text = open(path, encoding="utf-8").read()
        m = re.search(r"^---\n(.*?)\n---", text, re.S)
        if not m:
            continue
        fm = m.group(1)
        field = {}
        for key in ("word", "meaning", "correct", "category"):
            mm = re.search(rf"^{key}:\s*(.*)$", fm, re.M)
            if mm:
                field[key] = mm.group(1).strip()
        word = field.get("word", "").strip().lower()
        meaning = field.get("meaning", "").strip()
        if not word or not meaning:
            continue
        entry = {"trans": [meaning]}
        if field.get("correct"):
            entry["phonetic"] = field["correct"]
        if field.get("category"):
            entry["cat"] = field["category"]
        if word in words:
            old = words[word]
            if meaning not in old["trans"]:
                old["trans"].append(meaning)
        else:
            words[word] = entry
    return words


def prune_empty_trans(words):
    return {w: e for w, e in words.items() if e.get("trans")}


def save(name, source, words, out_name):
    data = {"name": name, "source": source, "count": len(words), "words": words}
    path = os.path.join(OUT, out_name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{out_name}: {len(words)} words, {os.path.getsize(path)//1024} KB")


gaokao = load_ndjson(["/tmp/dict/GaoZhong_2.json", "/tmp/dict/GaoZhong_3.json"])
save("Gaokao", "kajweb/dict (GaoZhong)", prune_empty_trans(gaokao), "gaokao.json")

cet4 = load_ndjson(["/tmp/dict/CET4_1.json", "/tmp/dict/CET4_2.json", "/tmp/dict/CET4_3.json"])
save("CET-4", "kajweb/dict (CET4)", prune_empty_trans(cet4), "cet4.json")

tech = load_tech_posts("/tmp/dict/most-frequent-technology-english-words-master")
save("Computing", "Wei-Xia/most-frequent-technology-english-words (MIT)", prune_empty_trans(tech), "computing.json")


def load_ogden():
    """Fetch ogden.munch.love and extract the embedded 850-word data."""
    import urllib.request

    html = urllib.request.urlopen("https://ogden.munch.love/", timeout=30).read().decode("utf-8")
    data = json.loads(re.search(r'<script id="data" type="application/json">(.*?)</script>', html, re.S).group(1))
    ipa = json.loads(re.search(r'<script id="ipa-data" type="application/json">(.*?)</script>', html, re.S).group(1))
    cats = {"op": "操作词", "gt": "一般事物", "pt": "可画名词", "qg": "一般性质", "qo": "对立性质"}
    words = {}
    for e in data:
        w = e["w"].strip().lower()
        zh = e.get("zh", "").strip()
        if not w or not zh:
            continue
        entry = {"trans": [p.strip() for p in re.split(r"[，,;；]", zh) if p.strip()][:3]}
        if e.get("c"):
            entry["cat"] = cats.get(e["c"], e["c"])
        p = ipa.get(w)
        if isinstance(p, dict):
            entry["phonetic"] = p.get("us") or p.get("uk") or ""
        elif isinstance(p, str):
            entry["phonetic"] = p
        if w in words:
            for t in entry["trans"]:
                if t not in words[w]["trans"]:
                    words[w]["trans"].append(t)
            words[w]["trans"] = words[w]["trans"][:3]
        else:
            words[w] = entry
    return words


save("Ogden 850", "ogden.munch.love", prune_empty_trans(load_ogden()), "ogden.json")
