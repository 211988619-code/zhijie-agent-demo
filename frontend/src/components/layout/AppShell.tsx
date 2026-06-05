import type { ReactNode } from "react";

type Props = {
  header: ReactNode;
  sidebar: ReactNode;
  children: ReactNode;
  rightPanel: ReactNode;
};

export function AppShell({ header, sidebar, children, rightPanel }: Props) {
  return (
    <div className="app-workspace-shell">
      <div className="app-shell-header">{header}</div>
      <div className="app-shell-body">
        <aside className="app-sidebar">{sidebar}</aside>
        <main className="app-main">{children}</main>
        <aside className="app-right-panel">{rightPanel}</aside>
      </div>
    </div>
  );
}
