import { BookOpenCheck, Bot, CalendarCheck, ClipboardCheck, FileText, LayoutDashboard, ListChecks, MessageCircle, Settings } from "lucide-react";

export type WorkspaceTab = "dashboard" | "materials" | "assistant" | "plan" | "quiz" | "trace" | "mistakes" | "review" | "settings";

type Props = {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
};

const tabs: Array<{ id: WorkspaceTab; label: string; helper: string; icon: typeof LayoutDashboard }> = [
  { id: "dashboard", label: "学习工作台", helper: "总览与下一步", icon: LayoutDashboard },
  { id: "materials", label: "资料与知识库", helper: "上传、卡片、概念", icon: FileText },
  { id: "assistant", label: "问 AI Agent", helper: "聊天问答与追问", icon: MessageCircle },
  { id: "plan", label: "学习计划", helper: "任务与进度", icon: ListChecks },
  { id: "quiz", label: "能力评估", helper: "诊断测验", icon: ClipboardCheck },
  { id: "mistakes", label: "错题本", helper: "错题记录、订正回顾", icon: BookOpenCheck },
  { id: "review", label: "今日复习", helper: "复习任务、知识检测", icon: CalendarCheck },
  { id: "trace", label: "Agent 执行过程", helper: "Trace Timeline", icon: Bot },
  { id: "settings", label: "设置 / More", helper: "模型配置与实验区", icon: Settings }
];

export function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="workspace-sidebar-nav" aria-label="学习工作台导航">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => onTabChange(tab.id)}>
            <Icon size={17} />
            <span>
              <strong>{tab.label}</strong>
              <small>{tab.helper}</small>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
