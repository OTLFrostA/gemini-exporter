# 手动导出到 Google Drive（测试版）

在 Options 中选择会话和格式，目标选择 **Google Drive**，首次选择时完成 Google 授权。核对「导出账号」中的邮箱后点击导出。点击「切换账号」可在 Google 选择其他账号，授权成功后面板显示新的收件账号。刷新时会尝试静默恢复上次选择的账号。连接失效时点击「重新连接」。文件固定保存到「我的云端硬盘 / Gemini Exporter」。第一次实际上传时，扩展在根目录查找可访问、可写的同名文件夹，找到就复用，否则创建。若用户自己建的同名文件夹对扩展不可见，Drive 可以在根目录保留两个同名文件夹。连接账号或跳过全部会话时不会创建目录。每条会话按选定格式单独保存为文件，外置附件按相对路径写入子目录。重新导出会更新插件可访问的同路径文件。目标目录存在时，点击 **保存到** 一行即可打开该目录。扩展向 Drive 回读核对每个文件的名称、大小、类型和父目录。文件继承用户自己的 Drive 访问控制。上传的内容包括本次选中的对话，以及导出设置包含的附件。关闭 Options 会中断尚未完成的操作。

## 配置一次

1. 在 Google Cloud 项目中启用 **Google Drive API**。在 Google Auth Platform 配置 Branding 和 Audience。外部应用在 Testing 状态下，将测试用 Google 账号加入 Test users。
2. 在 Clients 创建类型为 **Chrome Extension** 的 OAuth 客户端，Item ID 填 `kipakimegljfgbjchpljlmiahgnalfdj`。复制以 `.apps.googleusercontent.com` 结尾的公开客户端 ID。应用使用的 OAuth scope 为 `https://www.googleapis.com/auth/drive.file`。
3. 为账号切换配置同项目的 Web application OAuth 客户端，授权重定向 URI 填 `https://kipakimegljfgbjchpljlmiahgnalfdj.chromiumapp.org/drive-picker`（沿用该测试扩展先前注册的回调地址）。在测试包目录配置两个公开客户端 ID。

   ```sh
   python3 configure_drive_test.py extension --client-id 'CHROME_CLIENT_ID' --account-client-id 'WEB_CLIENT_ID'
   ```

4. 在独立的 Chrome 配置文件打开 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」，指向 **extension** 目录。已加载的副本需点击重新加载。扩展卡片显示的 ID 应和第 2 步一致。

## 试跑

- 用合成会话测试。选一篇 Markdown，核对 Drive 区域显示的 Google 邮箱和目标文件夹，然后在 Drive 打开生成的文件并核对正文。
- 再选择两篇并开启附件。在 Drive 中核对两个独立正文，以及正文所引用的附件子目录。PDF、DOCX、HTML、JSON 可用同一路径测试。
- 首次授权时取消，页面应显示连接失败，Drive 不应新增文件。上传失败时检查错误提示和 Drive 文件列表。重新导出会尝试更新同路径的可写文件。
- Drive 沿用「跳过已导出」设置。导出记录在各目标间共享；要把已导出的会话再上传到另一个位置，可以关闭此选项。

## 从 PR 源码构建

运行 `npm ci && npm run package`，在源码目录之外将生成的扩展 ZIP 解压到名为 `extension` 的子目录。从仓库复制 `scripts/configure_drive_test.py` 到其父目录，然后从上面第 3 步继续。

## Chrome 网上应用店发布

1. 在启用了 Google Drive API 的应用项目中创建 **Chrome Extension** OAuth 客户端。Item ID 填商店扩展 ID `ldpbiafkgjlaooeplkiooljccpalpkgf`。
2. 在同一个项目的 **Web application** OAuth 客户端中添加授权回调 `https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/drive-picker`，供「切换账号」使用。
3. 在 Google Auth Platform 中将发布面向外部用户的应用设为 **In production**，并完成控制台提示的品牌验证要求。**Testing** 仅允许名单中的账号使用。
4. 将两个公开客户端 ID 分别保存为 GitHub Actions 仓库变量 `DRIVE_CHROME_CLIENT_ID` 和 `DRIVE_WEB_CLIENT_ID`。标签发布流程将这些值、`identity` 权限和 `drive.file` scope 写入发布 ZIP 并检查成品。缺少配置时打包失败。

客户端 ID 随商店包分发。用户安装后在「导出到」选择 Google Drive，首次使用时授权自己的账号。商店包依赖商店为它分配的扩展 ID，本地解压测试使用上述专用配置。
