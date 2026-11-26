# 手动导出到 Google Drive（测试版）

在 Options 中选择会话和格式，目标选择 **Google Drive**，点击导出并确认目标邮箱。单个独立文档使用原格式，多文件和外置附件沿用浏览器下载的 ZIP 打包规则。上传完成后，点击 **在 Drive 中打开**。每次操作在「我的云端硬盘」中新建文件。文件继承用户自己的 Drive 访问控制。上传的内容包括本次选中的对话，以及导出设置包含的附件。关闭 Options 会中断尚未完成的操作。

## 配置一次

1. 在 Google Cloud 项目中启用 **Google Drive API**。在 Google Auth Platform 配置 Branding 和 Audience。外部应用在 Testing 状态下，将测试用 Google 账号加入 Test users。
2. 在 Clients 创建类型为 **Chrome Extension** 的 OAuth 客户端，Item ID 填 `kipakimegljfgbjchpljlmiahgnalfdj`。复制以 `.apps.googleusercontent.com` 结尾的公开客户端 ID。应用使用的 OAuth scope 为 `https://www.googleapis.com/auth/drive.file`。
3. 在提供的测试包目录打开终端，替换下面的客户端 ID 并运行。测试脚本只修改解压副本的 manifest。

   ```sh
   python3 configure_drive_test.py extension --client-id 'YOUR_ID.apps.googleusercontent.com'
   ```

4. 在独立的 Chrome 配置文件打开 `chrome://extensions`，开启开发者模式，选择「加载已解压的扩展程序」，指向 **extension** 目录。已加载的副本需点击重新加载。扩展卡片显示的 ID 应和第 2 步一致。

## 试跑

- 用合成会话测试。首次验证时关闭「跳过已导出」，选一篇 Markdown，确认提示中的 Google 邮箱，然后在 Drive 打开生成的文件并核对正文。
- 再选择两篇，或开启附件。下载 Drive 上的 ZIP 核对文件列表、格式和内容。PDF、DOCX、HTML、JSON 可用同一路径测试。
- 在目标邮箱确认框点击取消，Drive 不应新增文件。上传失败时检查错误提示和 Drive 文件列表；如果服务端已接收文件但确认回复丢失，再次手动导出可能新建副本。
- 「跳过已导出」沿用工作台原有的本地导出记录，跨目标生效。需要在不同目标各保存一份时取消勾选。

## 从 PR 源码构建

运行 `npm ci && npm run package`，在源码目录之外将生成的扩展 ZIP 解压到名为 `extension` 的子目录。从仓库复制 `scripts/configure_drive_test.py` 到其父目录，然后从上面第 3 步继续。正式 manifest 不含开发客户端或测试权限。
