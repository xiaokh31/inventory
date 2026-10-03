# UI 参考来源

用户指定项目：[xiaokh31/stripSystem](https://github.com/xiaokh31/stripSystem)。本次使用已验证 origin 的本机只读副本，提交 `1608420b6f5cd160624012b105cb5069261aa569`。

- `apps/web/src/app/globals.css`：语义颜色、系统字体、浅色和深色主题。
- `apps/web/src/components/layout/office-shell.tsx`、`office-navigation.tsx`：深色侧栏、顶栏、琥珀色活动边线、主题切换。
- `apps/web/src/components/dashboard/dashboard-components.tsx`：方形面板、带左侧色条的指标块。
- `apps/web/public/images/logos/wordmark-on-dark.png`：复制为本项目 `assets/brand-wordmark.png`。

本项目由 `src/office-theme.css` 实现对应风格，保留仓库地图和库存台账两项导航。没有修改参考仓库，也未引入其业务页面、数据或数据库。

2026-10-03 同样参考该提交的 `apps/web/src/lib/i18n/` 和 `apps/web/src/components/i18n/`：集中中英文词典、模板插值、顶栏语言按钮、Cookie/本地偏好和切换时保留表单草稿。实现及维护方式见 [布局与多语言管理](LAYOUT_AND_I18N.md)。
