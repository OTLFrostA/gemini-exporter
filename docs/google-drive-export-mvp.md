# 手动导出到 Google Drive（测试版）

在 Options 中选择会话和格式，目标选择 **Google Drive**，首次选择时完成 Google 授权。核对「导出账号」中的邮箱后点击导出。点击「切换账号」可在 Google 选择其他账号，授权成功后面板显示新的收件账号。刷新时会尝试静默恢复上次选择的账号。连接失效时点击「重新连接」。文件固定保存到「我的云端硬盘 / Gemini Exporter」。第一次实际上传时，扩展在根目录查找可访问、可写的同名文件夹，找到就复用，否则创建。若用户自己建的同名文件夹对扩展不可见，Drive 可以在根目录保留两个同名文件夹。连接账号或跳过全部会话时不会创建目录。每条会话按选定格式单独保存为文件，外置附件按相对路径写入子目录。重新导出会更新插件可访问的同路径文件。目标目录存在时，点击 **保存到** 一行即可打开该目录。扩展向 Drive 回读核对每个文件的名称、大小、类型和父目录。文件继承用户自己的 Drive 访问控制。上传的内容包括本次选中的对话，以及导出设置包含的附件。关闭 Options 会中断尚未完成的操作。

## 配置一次

1. 在 Google Cloud 项目中启用 **Google Drive API**。在 Google Auth Platform 配置 Branding 和 Audience。外部应用在 Testing 状态下，将测试用 Google 账号加入 Test users。
2. 创建或复用一个 **Web application** OAuth 客户端。在 **Authorized redirect URIs** 添加本地测试扩展的回调 `https://kipakimegljfgbjchpljlmiahgnalfdj.chromiumapp.org/drive-auth`。
3. 在测试包目录中配置该客户端的公开 ID。

   ```sh
   python3 configure_drive_test.py extension --client-id 'WEB_CLIENT_ID'
   ```

4. 在 Chrome 的 `chrome://extensions` 中开启开发者模式，选择「加载已解压的扩展程序」并指向 **extension** 目录。已加载的副本点击重新加载。扩展 ID 应与第 2 步一致。

## 试跑

- 用合成会话测试。选一篇 Markdown，核对 Drive 区域显示的 Google 邮箱和目标文件夹，然后在 Drive 打开生成的文件并核对正文。
- 再选择两篇并开启附件。在 Drive 中核对两个独立正文，以及正文所引用的附件子目录。PDF、DOCX、HTML、JSON 可用同一路径测试。
- 首次授权时取消，页面应显示连接失败，Drive 不应新增文件。上传失败时检查错误提示和 Drive 文件列表。重新导出会尝试更新同路径的可写文件。
- Drive 沿用「跳过已导出」设置。导出记录在各目标间共享；要把已导出的会话再上传到另一个位置，可以关闭此选项。

## 从 PR 源码构建

运行 `npm ci && npm run package`，在源码目录之外将生成的扩展 ZIP 解压到名为 `extension` 的子目录。从仓库复制 `scripts/configure_drive_test.py` 到其父目录，然后从上面第 3 步继续。

## Chrome 网上应用店发布

1. 在同一个 **Web application** OAuth 客户端中添加商店版回调 `https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/drive-auth`。
2. 在 Google Auth Platform 中将面向外部用户的应用设为 **In production**，并完成控制台提示的验证要求。**Testing** 仅允许名单中的账号使用。
3. 将公开客户端 ID 保存为 GitHub Actions 仓库变量 `DRIVE_WEB_CLIENT_ID`。标签发布流程将客户端 ID、`identity` 权限和 Drive API 主机权限写入发布 ZIP 并检查成品。缺少配置时打包失败。

首次连接、切换账号和恢复授权共用这个客户端，OAuth scope 为 `https://www.googleapis.com/auth/drive.file`。安装后，用户在「导出到」选择 Google Drive，并在 Google 授权窗口选择自己的账号。对于之前只通过 Chrome 默认账号授权的测试用户，新版首次连接时需要补做一次 Web OAuth 授权。
