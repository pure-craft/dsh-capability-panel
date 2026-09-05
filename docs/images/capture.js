/**
 * dsh-capability-panel 真实渲染截图工具(浏览器控制台运行)。
 *
 * 原理:把目标 DOM 克隆进 SVG <foreignObject>,内联文档样式表和 :root 的
 * CSS 变量,栅格化到 2x canvas 后下载 PNG。产出即真实渲染,非手绘示意。
 *
 * 用法:
 *   1. 打开会话面板(输入框右侧上下文图标)→ 运行 shot('.ci-panel', 'panel.png')
 *   2. 打开 设置 → 能力面板 → 运行 shot('.ci-preset-section', 'settings.png')
 */
async function shot(selector, filename) {
  const target = document.querySelector(selector);
  if (!target) {
    console.error(`没有找到 ${selector} —— 先打开对应面板再运行`);
    return;
  }

  // 1. 收集文档内所有同源样式表的规则文本
  let css = '';
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) css += rule.cssText + '\n';
    } catch { /* 跨源样式表跳过 */ }
  }

  // 2. :root 上的宿主 design token(--dsw-* 等)克隆进 foreignObject 后
  //    不在原文档树上,手动继承
  const vars = [];
  const rootStyle = getComputedStyle(document.documentElement);
  for (let i = 0; i < rootStyle.length; i++) {
    const name = rootStyle[i];
    if (name.startsWith('--')) vars.push(`${name}:${rootStyle.getPropertyValue(name)}`);
  }

  // 3. 克隆目标,包一层带字体/变量/背景的容器
  const rect = target.getBoundingClientRect();
  const width = Math.ceil(rect.width);
  const height = Math.ceil(rect.height);
  const clone = target.cloneNode(true);
  const bg = getComputedStyle(target).backgroundColor;
  const wrapper = document.createElement('div');
  wrapper.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  wrapper.setAttribute('style', `${vars.join(';')};font-family:${rootStyle.fontFamily};background:${bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' ? '#ffffff' : bg};width:${width}px;height:${height}px;overflow:hidden`);
  wrapper.appendChild(clone);

  // 4. 包成 SVG,栅格化(2x 高清)
  const scale = 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}">` +
    `<style>${css}</style>` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${new XMLSerializer().serializeToString(wrapper)}</foreignObject>` +
    `</svg>`;

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('SVG 栅格化失败 —— 面板里可能有 XML 不兼容的节点'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  canvas.toBlob((blob) => {
    if (!blob) {
      console.error('canvas 导出失败');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    console.log(`✅ 已下载 ${filename}(${width * scale}×${height * scale})`);
  }, 'image/png');
}
