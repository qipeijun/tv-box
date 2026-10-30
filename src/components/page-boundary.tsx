import { Component, type ReactNode } from "react";
import { Button } from "./ui/button";

/** 页面或懒加载模块失败时保留可操作的恢复入口，不清理订阅与观看记录。 */
export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  /** true：展示恢复入口；false：正常显示当前页面。 */
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main id="content" className="media-empty page-recovery" role="alert">
          <h1>界面暂时没有打开</h1>
          <p>
            可能遇到网络中断或版本更新。订阅与已保存的观看记录仍保留在此浏览器。
          </p>
          <div>
            <Button onClick={() => location.reload()}>重新打开当前页面</Button>
            <Button
              variant="outline"
              onClick={() => {
                history.replaceState(null, "", `${location.pathname}${location.search}`);
                location.reload();
              }}
            >
              返回首页
            </Button>
          </div>
        </main>
      );
    return this.props.children;
  }
}
