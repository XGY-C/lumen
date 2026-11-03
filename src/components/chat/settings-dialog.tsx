import {
  BotIcon,
  DatabaseIcon,
  DownloadIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
  Trash2Icon,
  UploadIcon,
  type LucideIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ModelManager } from '@/components/chat/model-manager'
import {
  exportSettings,
  importSettings,
} from '@/lib/app-settings'
import { clearAllSessions } from '@/lib/session-store'
import { useTheme, type ThemePreference } from '@/lib/use-theme'
import { cn } from '@/lib/utils'

/**
 * 完整设置面板。
 *
 * 三个分组：
 * 1. 外观 —— 主题（浅色 / 深色 / 跟随系统）
 * 2. 模型 —— 自定义模型管理（预设 / 自定义，多条并存，测试连接）
 * 3. 数据 —— 清空全部会话、导出 / 导入设置
 */

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SettingsTab = 'appearance' | 'model' | 'data'

const SETTINGS_TABS: {
  id: SettingsTab
  label: string
  icon: LucideIcon
}[] = [
  { id: 'appearance', label: '外观', icon: SunIcon },
  { id: 'model', label: '模型', icon: BotIcon },
  { id: 'data', label: '数据', icon: DatabaseIcon },
]

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  // 每次打开时回到「外观」这个默认页，避免停留在上次的某个子页
  const handleOpenChange = (next: boolean) => {
    onOpenChange(next)
    if (next) setActiveTab('appearance')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-[min(44rem,calc(100vw-2rem))] sm:w-[44rem] sm:max-w-[44rem]">
        <DialogHeader>
          <DialogTitle className="text-lead">设置</DialogTitle>
          <DialogDescription className="text-ui">
            这些设置保存在本机，仅对本浏览器生效。
          </DialogDescription>
        </DialogHeader>

        <SettingsBody
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  )
}

function SettingsBody({
  activeTab,
  onSelectTab,
  onOpenChange,
}: {
  activeTab: SettingsTab
  onSelectTab: (tab: SettingsTab) => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <div className="flex h-[min(70vh,36rem)] min-h-0 gap-0">
      {/* 左侧 Tab 导航 */}
      <nav
        aria-label="设置分组"
        className="border-border/60 -ms-1 flex w-32 shrink-0 flex-col gap-0.5 border-e pe-1 md:w-40"
      >
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'text-muted-foreground hover:bg-accent hover:text-foreground',
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-ui',
                'transition-colors duration-150 focus-ring',
                active && 'bg-accent text-foreground font-medium',
              )}
            >
              <Icon
                className={cn('size-4 shrink-0', active && 'text-brand')}
                strokeWidth={1.75}
              />
              <span className="truncate">{label}</span>
            </button>
          )
        })}
      </nav>

      {/* 右侧内容 */}
      <div className="thin-scroll min-w-0 flex-1 overflow-y-auto overscroll-contain ps-4 md:ps-5">
        <div className="flex flex-col gap-5">
          {activeTab === 'appearance' && <AppearanceSection />}
          {activeTab === 'model' && <ModelSection />}
          {activeTab === 'data' && <DataSection onOpenChange={onOpenChange} />}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 分组容器                                                            */
/* ------------------------------------------------------------------ */

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="text-muted-foreground size-4 shrink-0" strokeWidth={1.75} />
        <h2 className="text-ui font-medium">{title}</h2>
      </div>
      {description && (
        <p className="text-muted-foreground -mt-2 text-meta">{description}</p>
      )}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* 1. 外观                                                              */
/* ------------------------------------------------------------------ */

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: '浅色', icon: SunIcon },
  { value: 'dark', label: '深色', icon: MoonIcon },
  { value: 'system', label: '跟随系统', icon: MonitorIcon },
]

function AppearanceSection() {
  const { preference, setTheme } = useTheme()

  return (
    <Section icon={SunIcon} title="外观" description="界面配色，可随时在顶栏切换">
      <div role="radiogroup" aria-label="主题" className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = preference === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(value)}
              className={cn(
                'border-border flex h-16 flex-col items-center justify-center gap-1.5 rounded-lg border',
                'text-muted-foreground transition-colors duration-150',
                'hover:bg-accent/60 hover:text-foreground',
                'focus-ring',
                active && 'border-brand/60 bg-accent text-foreground',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              <span className="text-meta">{label}</span>
            </button>
          )
        })}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* 2. 模型                                                              */
/* ------------------------------------------------------------------ */

function ModelSection() {
  return (
    <Section
      icon={BotIcon}
      title="模型"
      description="配置对话使用的模型，支持本地与云端服务"
    >
      <ModelManager />
    </Section>
  )
}

/* ------------------------------------------------------------------ */
/* 3. 数据                                                              */
/* ------------------------------------------------------------------ */

function DataSection({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [confirmClear, setConfirmClear] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleClear = () => {
    clearAllSessions()
    setConfirmClear(false)
    onOpenChange(false)
  }

  const handleExport = () => {
    const json = exportSettings()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lumen-settings-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (file: File) => {
    file
      .text()
      .then((text) => {
        if (importSettings(text)) {
          // 模型名 / 主题的 store 缓存了内存副本，刷新让首帧脚本重读
          window.location.reload()
        } else {
          window.alert('导入失败：文件不是有效的设置备份。')
        }
      })
      .catch(() => window.alert('读取文件失败。'))
  }

  return (
    <Section
      icon={DatabaseIcon}
      title="数据"
      description="管理本地保存的会话与设置"
    >
      <div className="flex flex-col gap-2">
        <div className="border-border flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-ui font-medium">清空全部会话</p>
            <p className="text-muted-foreground mt-0.5 text-meta">
              删除所有对话记录，无法恢复
            </p>
          </div>
          {confirmClear ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setConfirmClear(false)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-8"
                onClick={handleClear}
              >
                确认清空
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => setConfirmClear(true)}
            >
              <Trash2Icon className="size-3.5" strokeWidth={1.75} />
              清空
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <DownloadIcon className="size-3.5" strokeWidth={1.75} />
            导出设置
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <UploadIcon className="size-3.5" strokeWidth={1.75} />
            导入设置
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) handleImportFile(file)
              event.target.value = ''
            }}
          />
        </div>
      </div>
    </Section>
  )
}
