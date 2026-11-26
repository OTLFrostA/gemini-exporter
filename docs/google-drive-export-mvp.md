# 手动导出到 Google Drive（测试版）

在 Options 中选择会话和格式，目标选择 **Google Drive**，首次选择时完成 Google 授权。核对页面显示的邮箱，选择目标文件夹，再点击导出。默认上传到「我的云端硬盘」。点击「选择目标文件夹…」会打开 Google 托管的 OAuth 选择页（实验功能）。扩展核对账号与写入权限后，按账号记住目录。取消会保留原目标。单个独立文档使用原格式，多文件和外置附件沿用浏览器下载的 ZIP 打包规则。上传完成后，点击 **在 Drive 中打开**。扩展在所选位置新建文件，并向 Drive 回读核对文件名、大小、类型和父目录。文件继承用户自己的 Drive 访问控制。上传的内容包括本次选中的对话，以及导出设置包含的附件。关闭 Options 会中断尚未完成的操作。

## 配置一次

1. 在 Google Cloud 项目中启用 **Google Drive API** 和 **Google Picker API**。在 Google Auth Platform 配置 Branding 和 Audience。外部应用在 Testing 状态下，将测试用 Google 账号加入 Test users。
2. 在 Clients 创建类型为 **Chrome Extension** 的 OAuth 客户端，Item ID 填 `kipakimegljfgbjchpljlmiahgnalfdj`。复制以 `.apps.googleusercontent.com` 结尾的公开客户端 ID。应用使用的 OAuth scope 为 `https://www.googleapis.com/auth/drive.file`。
3. 在同一项目新增 **Web application** OAuth 客户端。在 **Authorized redirect URIs** 添加 `https://kipakimegljfgbjchpljlmiahgnalfdj.chromiumapp.org/drive-picker`。用两个公开客户端 ID 配置测试包：

   ```sh
   python3 configure_drive_test.py extension --client-id 'CHROME_CLIENT_ID' --picker-client-id 'WEB_CLIENT_ID'
   ```

   扩展用 Chrome 身份 API 打开 Google 授权页面，实验性请求浏览器 access token 和单个文件夹 ID。Google 的桌面 Picker 示例使用授权码。Web 客户端 token 回调能否同时返回目录 ID，仍须真实账号验证。此方案无需本机监听端口、网站部署、Picker API key 或客户端密钥。

4. 在独立的 Chrome 配置文件打开 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」，指向 **extension** 目录。已加载的副本需点击重新加载。扩展卡片显示的 ID 应和第 2 步一致。

## 试跑

- 用合成会话测试。选一篇 Markdown，核对 Drive 区域显示的 Google 邮箱和目标文件夹，然后在 Drive 打开生成的文件并核对正文。
- 再选择两篇，或开启附件。下载 Drive 上的 ZIP 核对文件列表、格式和内容。PDF、DOCX、HTML、JSON 可用同一路径测试。
- 首次授权时取消，页面应显示连接失败，Drive 不应新增文件。上传失败时检查错误提示和 Drive 文件列表；如果服务端已接收文件但确认回复丢失，再次手动导出可能新建副本。
- Drive 沿用「跳过已导出」设置。导出记录在各目标间共享；要把已导出的会话再上传到另一个位置，可以关闭此选项。

## 从 PR 源码构建

运行 `npm ci && npm run package`，在源码目录之外将生成的扩展 ZIP 解压到名为 `extension` 的子目录。从仓库复制 `scripts/configure_drive_test.py` 到其父目录，然后从上面第 3 步继续。正式 manifest 不含开发客户端或测试权限。
