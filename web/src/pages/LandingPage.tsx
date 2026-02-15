import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { 
  BookOpen, 
  Sparkles, 
  Wand2, 
  Network, 
  Clapperboard, 
  ArrowRight,
  ChevronRight,
  Download,
  Zap,
  Brain,
  FileText,
  Bot
} from 'lucide-react';

const ANDROID_DIRECT_DOWNLOAD_URL =
  'https://github.com/doctoroyy/novel-copilot/releases/download/mobile-builds/NovelCopilot-android-universal.apk';
const ANDROID_ACCELERATED_DOWNLOAD_URL = `https://ghproxy.net/${ANDROID_DIRECT_DOWNLOAD_URL}`;

export function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl gradient-bg flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-white" />
              </div>
              <span className="font-bold text-xl gradient-text">Novel Copilot</span>
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Link to="/login">
                <Button variant="outline" size="sm">登录</Button>
              </Link>
              <Link to="/login">
                <Button size="sm" className="gradient-bg">开始创作</Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background Effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>
        
        <div className="relative max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-8 border border-primary/20">
            <Sparkles className="h-4 w-4" />
            <span>AI 驱动的小说创作平台</span>
          </div>
          
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold mb-6 leading-tight">
            让 AI 成为你的
            <br />
            <span className="gradient-text">创作副驾驶</span>
          </h1>
          
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            从大纲规划到章节生成，从角色设定到剧情发展，
            <br className="hidden sm:block" />
            Novel Copilot 让长篇小说创作变得前所未有的高效
          </p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/login">
              <Button size="lg" className="gradient-bg text-lg px-8 h-14 group">
                免费开始创作
                <ArrowRight className="ml-2 h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
            <Button
              size="lg"
              variant="outline"
              className="text-lg px-8 h-14"
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              了解更多
            </Button>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button asChild variant="secondary" size="sm" className="h-10">
              <a href={ANDROID_ACCELERATED_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                <Download className="h-4 w-4 mr-2" />
                Android 下载（国内加速）
              </a>
            </Button>
            <a
              href={ANDROID_DIRECT_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              GitHub 直链
            </a>
          </div>

          <div className="mt-12 max-w-5xl mx-auto">
            <div className="glass-card rounded-2xl p-3 sm:p-4 border border-border/60">
              <img
                src="/app-poster-cn.png"
                alt="Novel Copilot App 海报"
                className="w-full h-auto rounded-xl"
                loading="lazy"
              />
            </div>
          </div>
          
          {/* Stats */}
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto">
            <div>
              <div className="text-3xl font-bold gradient-text">400+</div>
              <div className="text-sm text-muted-foreground">章节容量</div>
            </div>
            <div>
              <div className="text-3xl font-bold gradient-text">100万</div>
              <div className="text-sm text-muted-foreground">字长篇创作</div>
            </div>
            <div>
              <div className="text-3xl font-bold gradient-text">∞</div>
              <div className="text-sm text-muted-foreground">创意可能</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 px-4 sm:px-6 lg:px-8 bg-muted/30">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              全流程 AI 辅助创作
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              从灵感到成稿，每一步都有 AI 相伴
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl gradient-bg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <FileText className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">智能大纲生成</h3>
              <p className="text-muted-foreground">
                输入创意设定，AI 自动规划完整故事架构，支持分卷分章的精细化管理
              </p>
            </div>
            
            {/* Feature 2 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Wand2 className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">批量章节生成</h3>
              <p className="text-muted-foreground">
                一键生成多章内容，AI 自动保持剧情连贯，人物性格一致
              </p>
            </div>
            
            {/* Feature 3 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Brain className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">角色设定管理</h3>
              <p className="text-muted-foreground">
                自动提取并维护角色档案，确保人物形象始终如一
              </p>
            </div>
            
            {/* Feature 4 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Network className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">人物关系图谱</h3>
              <p className="text-muted-foreground">
                可视化展示角色之间的复杂关系，让剧情走向更加清晰
              </p>
            </div>
            
            {/* Feature 5 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Clapperboard className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">AI 动漫化</h3>
              <p className="text-muted-foreground">
                一键将小说转化为动漫剧本和分镜，探索 IP 可视化的无限可能
              </p>
            </div>
            
            {/* Feature 6 */}
            <div className="glass-card p-6 rounded-2xl hover-lift group">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Bot className="h-6 w-6 text-white" />
              </div>
              <h3 className="text-xl font-semibold mb-2">多模型支持</h3>
              <p className="text-muted-foreground">
                支持 Gemini、Claude、GPT 等多种 AI 模型，选择最适合的创作伙伴
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              三步开启 AI 创作之旅
            </h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full gradient-bg flex items-center justify-center mx-auto mb-6 text-2xl font-bold text-white">
                1
              </div>
              <h3 className="text-xl font-semibold mb-2">描述你的故事</h3>
              <p className="text-muted-foreground">
                输入类型、主题、关键设定，让 AI 了解你的创作愿景
              </p>
            </div>
            
            <div className="text-center relative">
              <ChevronRight className="hidden md:block absolute left-0 top-8 -translate-x-1/2 h-8 w-8 text-muted-foreground/30" />
              <div className="w-16 h-16 rounded-full gradient-bg flex items-center justify-center mx-auto mb-6 text-2xl font-bold text-white">
                2
              </div>
              <h3 className="text-xl font-semibold mb-2">生成完整大纲</h3>
              <p className="text-muted-foreground">
                AI 自动规划分卷章节，你可以随时调整和优化
              </p>
            </div>
            
            <div className="text-center relative">
              <ChevronRight className="hidden md:block absolute left-0 top-8 -translate-x-1/2 h-8 w-8 text-muted-foreground/30" />
              <div className="w-16 h-16 rounded-full gradient-bg flex items-center justify-center mx-auto mb-6 text-2xl font-bold text-white">
                3
              </div>
              <h3 className="text-xl font-semibold mb-2">批量生成内容</h3>
              <p className="text-muted-foreground">
                一键启动，看着你的故事逐章成型
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          <div className="glass-card rounded-3xl p-8 sm:p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-purple-500/10" />
            <div className="relative">
              <Zap className="h-12 w-12 mx-auto mb-6 text-primary" />
              <h2 className="text-3xl sm:text-4xl font-bold mb-4">
                准备好开始创作了吗？
              </h2>
              <p className="text-muted-foreground text-lg mb-8 max-w-xl mx-auto">
                加入 Novel Copilot，让 AI 帮你把脑海中的故事变成现实
              </p>
              <Link to="/login">
                <Button size="lg" className="gradient-bg text-lg px-10 h-14">
                  立即开始
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-border">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold gradient-text">Novel Copilot</span>
            </div>
            <p className="text-sm text-muted-foreground">
              © 2026 Novel Copilot. 让每个人都能成为小说家。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
