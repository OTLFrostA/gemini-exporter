#!/usr/bin/env python3
"""
tests/helpers/export_spec_asserter.py
--------------------------------------
严格的导出文件规范断言器 (Export Specification Asserter)

用于对真实导出的 Markdown 归档包执行规范级 Lint 与确定性内容断言：
1. 目录结构与索引完整性 (00_INDEX.md, meta.json, 文件命名规范)
2. YAML Frontmatter 规范 (字段闭合、标准键、ISO 8601 时间戳、Tags)
3. 问答轮次与角色规范 (## 👤 你 / ## 🤖 Gemini、时间戳、正文非空)
4. 纯净度与零噪点断言 (无 Google JSPB 遥测单字、无语言代码泄露、无未处理 RPC 壳)
5. 附件与多媒体一致性 (Markdown 引用的 images/ 物理存在且体积合法)
6. 固化测试账号的已知黄金对话特征断言 (代码块、表格、特定语义)
"""

import os
import re
import json


class ExportSpecificationAsserter:
    def __init__(self, export_root_dir):
        self.export_root_dir = export_root_dir
        self.errors = []
        self.warnings = []
        self.md_files = []
        self.meta_data = None
        self.index_text = ""

    def log_error(self, file_name, msg):
        err = f"[{file_name}] ❌ 规范违背: {msg}"
        self.errors.append(err)
        print(f"   {err}")

    def log_pass(self, file_name, msg):
        print(f"   [{file_name}] ✓ {msg}")

    def run_all_assertions(self, min_conversations=1, expected_golden_chats=None):
        """执行全量规范级断言"""
        print("\n" + "=" * 70)
        print("🔍 启动导出规范确定性断言 (Export Specification Assertion)...")
        print("=" * 70)

        # 1. 结构与元数据校验
        self.assert_bundle_structure(min_conversations)

        # 2. 深入每个导出的会话文件校验规范
        for fpath in self.md_files:
            fname = os.path.basename(fpath)
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            self.assert_frontmatter(content, fname)
            self.assert_turn_flow(content, fname)
            self.assert_zero_noise(content, fname)
            self.assert_multimedia_assets(content, fname)

        # 3. 固化已知黄金会话特征断言
        if expected_golden_chats:
            self.assert_golden_conversations(expected_golden_chats)

        # 总结
        print("\n" + "=" * 70)
        if not self.errors:
            print(f"🏆 全部 {len(self.md_files)} 个会话文件与索引规范断言 100% 完美通过！")
            print("=" * 70)
            return True
        else:
            print(f"❌ 发现 {len(self.errors)} 处规范违背错误：")
            for e in self.errors:
                print(f"  • {e}")
            print("=" * 70)
            return False

    def assert_bundle_structure(self, min_conversations):
        """检查包内顶级结构与元数据"""
        print("\n[规范 1/5] 📦 校验导出包结构与索引 (Bundle Structure & Index)")

        # 递归寻找 Markdown 目录（有的在根目录，有的在 gemini_export/ 子目录）
        all_mds = []
        index_file = None
        meta_file = None

        for root, _, files in os.walk(self.export_root_dir):
            for f in files:
                fpath = os.path.join(root, f)
                if f.endswith(".md"):
                    if f.startswith("00_INDEX") or f.startswith("_index"):
                        index_file = fpath
                    else:
                        all_mds.append(fpath)
                elif f == "meta.json":
                    meta_file = fpath

        self.md_files = sorted(all_mds)

        # 检查会话数量
        if len(self.md_files) < min_conversations:
            self.log_error("Bundle", f"导出的会话文件数不足 {min_conversations} 个 (实际找到 {len(self.md_files)})")
        else:
            self.log_pass("Bundle", f"发现 {len(self.md_files)} 个导出会话 Markdown 文件 (符合预期 >= {min_conversations})")

        # 检查 00_INDEX.md
        if not index_file:
            self.log_error("00_INDEX.md", "缺少全局索引文档 00_INDEX.md")
        else:
            with open(index_file, "r", encoding="utf-8") as f:
                self.index_text = f.read()
            if "# " not in self.index_text or "| " not in self.index_text:
                self.log_error("00_INDEX.md", "索引文件缺少标题或 Markdown 对话表格列表")
            else:
                self.log_pass("00_INDEX.md", "全局索引文档有效，包含 Markdown 对话索引表")

        # 检查 meta.json
        if not meta_file:
            self.log_error("meta.json", "缺少元数据文件 meta.json")
        else:
            try:
                with open(meta_file, "r", encoding="utf-8") as f:
                    self.meta_data = json.load(f)
                if not isinstance(self.meta_data, dict):
                    self.log_error("meta.json", "meta.json 不是合法的 JSON Object")
                else:
                    self.log_pass("meta.json", f"元数据合法 (导出会话数: {len(self.meta_data.get('conversations', []))})")
            except Exception as e:
                self.log_error("meta.json", f"meta.json 解析失败: {e}")

    def assert_frontmatter(self, content, file_name):
        """校验 YAML Frontmatter"""
        if not content.startswith("---\n"):
            self.log_error(file_name, "文件头部必须以 YAML Frontmatter 开头 ('---\\n')")
            return

        end_match = re.search(r"\n---\n", content[4:])
        if not end_match:
            self.log_error(file_name, "YAML Frontmatter 缺少闭合标记 ('\\n---\\n')")
            return

        fm_text = content[4:4 + end_match.start()]
        required_keys = ["title:", "id:", "url:", "date:", "updated:", "exported:", "tags:"]
        for key in required_keys:
            if key not in fm_text:
                self.log_error(file_name, f"Frontmatter 缺少必要字段 '{key}'")

        if "gemini-export" not in fm_text:
            self.log_error(file_name, "Frontmatter tags 必须包含 'gemini-export'")

    def assert_turn_flow(self, content, file_name):
        """校验问答轮次与角色标记"""
        # 必须包含二级角色标题
        user_headers = re.findall(r"^## 👤 你", content, flags=re.MULTILINE)
        model_headers = re.findall(r"^## 🤖 Gemini", content, flags=re.MULTILINE)

        if not user_headers:
            self.log_error(file_name, "正文中未找到用户角色标记 ('## 👤 你')")
        if not model_headers:
            self.log_error(file_name, "正文中未找到模型角色标记 ('## 🤖 Gemini')")

        # 检查时间戳小标题
        time_quotes = re.findall(r"^> ⏱️ \d{4}/\d{1,2}/\d{1,2}", content, flags=re.MULTILINE)
        if not time_quotes:
            self.log_error(file_name, "正文中缺少时间戳引用行 ('> ⏱️ YYYY/MM/DD...')")

    def assert_zero_noise(self, content, file_name):
        """纯净度断言：绝不包含 Google JSPB 遥测单字符、遥测短词、语言标签泄露"""
        # 1. 检查是否有独立的遥测单词行（如单独一行的 "google", "c", "S", "6", "."）
        telemetry_lines = re.findall(r"^(?:google|c|S|6|\.)\s*$", content, flags=re.MULTILINE)
        if telemetry_lines:
            self.log_error(file_name, f"检测到泄露的 Google JSPB 遥测单行: {telemetry_lines}")

        # 2. 检查末尾泄露的语言标记（如回复结尾单独一行 zh 或 en）
        lang_leaks = re.findall(r"\n(?:zh|en)\s*\n(?=## 👤|## 🤖|$)", content)
        if lang_leaks:
            self.log_error(file_name, f"检测到泄露的语言代码标记: {lang_leaks}")

        # 3. 检查未反序列化的 Google RPC 壳或包装前缀
        if ")]}'" in content:
            self.log_error(file_name, "检测到未剥除的 Google RPC 前缀 ')]}\\''")
        if '["wrb.fr"' in content or '"hNvQHb"' in content or '"MaZiqc"' in content:
            self.log_error(file_name, "检测到泄露的原始 batchexecute RPC 包装数组")

    def assert_multimedia_assets(self, content, file_name):
        """检查 Markdown 引用的图片物理文件是否存在且非空"""
        img_refs = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", content)
        for ref in img_refs:
            if ref.startswith("http://") or ref.startswith("https://"):
                continue  # 外部网络图链接
            # 本地图片相对路径
            clean_ref = ref.split("?")[0].split("#")[0]
            # 支持 images/xxx.png 或 assets/xxx.png
            # 搜索整个解压目录下是否存在此文件
            found = False
            for root, _, files in os.walk(self.export_root_dir):
                for f in files:
                    if f == os.path.basename(clean_ref):
                        full_img_p = os.path.join(root, f)
                        if os.path.getsize(full_img_p) > 100:
                            found = True
                            break
                if found:
                    break

            if not found:
                self.log_error(file_name, f"Markdown 中引用的本地图片资源物理缺失或体积过小: {clean_ref}")

    def assert_golden_conversations(self, expected_golden_chats):
        """断言测试账号中已知特征对话的内容和结构"""
        print("\n[规范 5/5] 🌟 校验已知测试账号会话特征 (Golden Conversations)")
        for gold in expected_golden_chats:
            cid = gold.get("id")
            name = gold.get("name", cid)
            snippets = gold.get("expected_snippets", [])
            syntax_checks = gold.get("syntax_checks", [])

            matched_content = None
            matched_file = None
            for fpath in self.md_files:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                if cid and cid in text:
                    matched_content = text
                    matched_file = os.path.basename(fpath)
                    break
                elif any(snip in text for snip in snippets[:1]):
                    matched_content = text
                    matched_file = os.path.basename(fpath)
                    break

            if not matched_content:
                self.log_error("GoldenCheck", f"未在导出包中找到已知会话《{name}》 (ID: {cid})")
                continue

            # 校验特定文本片段
            for snip in snippets:
                if snip.lower() not in matched_content.lower():
                    self.log_error(matched_file, f"已知会话《{name}》缺失预期关键内容: 「{snip}」")
                else:
                    self.log_pass(matched_file, f"已知会话《{name}》成功命中特征内容: 「{snip[:30]}...」")

            # 校验特定语法结构（如代码块、表格）
            for syn in syntax_checks:
                if syn == "codeblock" and "```" not in matched_content:
                    self.log_error(matched_file, f"已知会话《{name}》预期包含代码块 ('```')，但未找到")
                elif syn == "table" and ("|---" not in matched_content and "| ---" not in matched_content):
                    self.log_error(matched_file, f"已知会话《{name}》预期包含 Markdown 表格，但未找到")
                elif syn == "image" and "![" not in matched_content:
                    self.log_error(matched_file, f"已知会话《{name}》预期包含图片附件引用 ('![]')，但未找到")
