# 手动导出到 Google Drive

在 Options 中选择会话和格式，目标选择 **Google Drive**，首次选择时完成 Google 授权。核对「导出账号」中的邮箱后点击导出。点击「切换账号」可在 Google 选择其他账号，授权成功后面板显示新的收件账号。刷新时会尝试静默恢复上次选择的账号。连接失效时点击「重新连接」。文件固定保存到「我的云端硬盘 / Gemini Exporter」。第一次实际上传时，扩展在根目录查找可访问、可写的同名文件夹，找到就复用，否则创建。若用户自己建的同名文件夹对扩展不可见，Drive 可以在根目录保留两个同名文件夹。连接账号或跳过全部会话时不会创建目录。每条会话按选定格式单独保存为文件，外置附件按相对路径写入子目录。重新导出会更新插件可访问的同路径文件。目标目录存在时，点击 **保存到** 一行即可打开该目录。扩展向 Drive 回读核对每个文件的名称、大小、类型和父目录。文件继承用户自己的 Drive 访问控制。上传的内容包括本次选中的对话，以及导出设置包含的附件。关闭 Options 会中断尚未完成的操作。

## 配置 Google Cloud

1. 启用 **Google Drive API**。在 Google Auth Platform 配置 Branding 和 Audience。公开发布前确认应用为 **In production**，并完成控制台提示的验证要求。若先在 **Testing** 状态下验收，将测试账号加入 Test users。
2. 创建或复用一个 **Web application** OAuth 客户端。在 **Authorized redirect URIs** 添加 `https://ldpbiafkgjlaooeplkiooljccpalpkgf.chromiumapp.org/drive-auth`。

## 使用发布包验收

标签发布流程通过 GitHub Actions 仓库变量 `DRIVE_WEB_CLIENT_ID` 取得公开客户端 ID。构建将客户端 ID、Chrome 商店公钥、`identity` 权限和 Drive API 主机权限写入发布 ZIP，并检查成品使用正确的扩展 ID。

本地验收使用相同的发布 ZIP。在独立 Chrome 配置档中打开 `chrome://extensions`，开启开发者模式，将 ZIP 解压后作为扩展加载。核对扩展 ID 为 `ldpbiafkgjlaooeplkiooljccpalpkgf`。本地验收和商店安装使用同一个 OAuth 客户端及回调。商店签名与安装流程在上架后使用商店安装验证。

也可从候选提交运行 `npm ci`，设置环境变量 `DRIVE_WEB_CLIENT_ID` 后执行 `npm run package -- --chrome-web-store`，用相同的打包入口生成待验收的 ZIP。

## 试跑

- 用合成会话测试。选一篇 Markdown，核对 Drive 区域显示的 Google 邮箱和目标文件夹，然后在 Drive 打开生成的文件并核对正文。
- 再选择两篇并开启附件。在 Drive 中核对两个独立正文，以及正文所引用的附件子目录。PDF、DOCX、HTML、JSON 可用同一路径测试。
- 首次授权时取消，页面应显示连接失败，Drive 不应新增文件。上传失败时检查错误提示和 Drive 文件列表。重新导出会尝试更新同路径的可写文件。
- Drive 沿用「跳过已导出」设置。导出记录在各目标间共享；要把已导出的会话再上传到另一个位置，可以关闭此选项。
