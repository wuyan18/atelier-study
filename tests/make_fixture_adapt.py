# -*- coding: utf-8 -*-
"""生成"未来资料"适配性测试用的固定素材（tests/fixture_adapt）。
真实资料目录只读，这里造一份等结构的小样本，供 server 用 --data-root 指过去测试。"""
import os, struct, zlib

ROOT = r"C:\Users\18722\course-reader\tests\fixture_adapt"

def write(rel, data):
    full = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    mode = "wb" if isinstance(data, bytes) else "w"
    if mode == "wb":
        with open(full, "wb") as f:
            f.write(data)
    else:
        with open(full, "w", encoding="utf-8", newline="\n") as f:
            f.write(data)
    print("  +", rel, len(data), "B")

def png1x1():
    def chunk(tag, payload):
        c = tag + payload
        return struct.pack(">I", len(payload)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\x30\x60\xf0"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

print("生成 fixture:", ROOT)
write("适配性测试/01-课件/讲义.md", "# 讲义\n\n测试用 Markdown。\n\n| 列 | 值 |\n|---|---|\n| a | 1 |\n")
write("适配性测试/02-作业/作业01/作业01-题目.md", "# 题目\n\n1. 证明 x>0\n")
write("适配性测试/02-作业/作业01/作业01-作答.md", "# 作答\n\n因为……\n")
write("适配性测试/03-代码/hello.go",
      'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}\n')
write("适配性测试/03-代码/run.sh",
      '#!/bin/bash\nset -e\nfor i in 1 2 3; do\n  echo "$i"\ndone\n')
write("适配性测试/03-代码/main.rs",
      'fn main() {\n    let n: u32 = 3;\n    println!("n = {}", n);\n}\n')
write("适配性测试/03-代码/Main.java",
      'public class Main {\n  public static void main(String[] a) {\n    System.out.println("hi");\n  }\n}\n')
write("适配性测试/03-代码/infer.py",
      'def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n')
write("适配性测试/03-代码/Makefile",
      'all:\n\tgcc -O2 -o app main.c\n\nclean:\n\trm -f app\n')
write("适配性测试/03-代码/Dockerfile",
      'FROM python:3.12-slim\nWORKDIR /app\nCOPY . .\nCMD ["python", "infer.py"]\n')
write("适配性测试/03-代码/config.yaml",
      'server:\n  port: 8765\n  host: 127.0.0.1\nitems:\n  - a\n  - b\n')
write("适配性测试/03-代码/nb.ipynb",
      '{"cells":[{"cell_type":"markdown","source":["# title"]}],"nbformat":4,"nbformat_minor":5}\n')
write("适配性测试/03-代码/查询.sql",
      'SELECT name, size FROM files WHERE size > 1024 ORDER BY size DESC;\n')
write("适配性测试/04-杂项/pack.rar", b"Rar!\x1a\x07\x00" + b"\x00" * 40)
write("适配性测试/04-杂项/scan.tif", b"II*\x00" + b"\x00" * 40)
write("适配性测试/04-杂项/notes.txt", "第一行\n第二行\n")
write("适配性测试/04-杂项/app.log", "[INFO] start\n[WARN] disk\n")
write("适配性测试/04-杂项/sample.csv", "a,b,c\n1,2,3\n")
write("适配性测试/04-杂项/图.png", png1x1())
write("适配性测试/04-杂项/bundle.zip", b"PK\x03\x04" + b"\x00" * 40)
write("适配性测试/99-旧资料/old.md", "# 旧资料\n")
write("说明.md", "# 适配性测试素材\n\n本目录只用于测试，不是真实课程资料。\n")
print("done")
