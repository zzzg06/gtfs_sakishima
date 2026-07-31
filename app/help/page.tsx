import type { Metadata } from "next"
import Link from "next/link"
import {
  Search,
  Clock,
  Train,
  Bus,
  Map as MapIcon,
  Info,
  Footprints,
  ArrowRight,
  CircleHelp,
  Lightbulb,
  AlertTriangle,
} from "lucide-react"

export const metadata: Metadata = {
  title: "使い方",
  description: "関南乗換案内の使い方。経路検索・時刻表・列車走行位置の見かたを初めての方向けに説明します。",
}

// サイトの使い方（初心者向け）。実装済みの機能だけを説明する。
// 機能を追加・変更したときはこのページも合わせて更新すること。

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Search
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-foreground">
        <Icon className="h-5 w-5 shrink-0 text-green-700" />
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  )
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-700 text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <Lightbulb className="h-4 w-4 shrink-0 translate-y-0.5" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="mx-auto max-w-2xl space-y-5 lg:max-w-4xl">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
              <CircleHelp className="h-6 w-6 text-green-700" />
              このサイトの使い方
            </h1>
            <p className="mt-2 text-muted-foreground">
              関南乗換案内は、咲島の鉄道・バスをまとめて調べられる乗換案内です。
              はじめての方はこのページを上から読めば、ひととおりの機能がわかります。
            </p>
          </div>

          {/* 1. 経路検索 */}
          <Section icon={Search} title="1. 目的地までの行き方を調べる（検索）">
            <div className="space-y-3">
              <Step n={1} title="「出発」と「到着」に駅名・バス停名を入力する">
                ひらがな（例: さきしまこう）やローマ字（例: kiritachi）でも候補が出ます。
                入力欄をクリックすると、最近使った駅も表示されます。候補が出たら
                <span className="font-medium text-foreground"> Enter キーで先頭の候補</span>を選べます。
              </Step>
              <Step n={2} title="日時を選ぶ">
                「出発」は指定時刻以降に出る便、「到着」は指定時刻までに着く便、「指定なし」は時刻を問わず早い順に探します。
                時刻の横の「現在 / −10分 / +10分」ボタンが便利です。
              </Step>
              <Step n={3} title="必要なら「手段」を調整する">
                徒歩・バス・タクシーの利用可否を切り替えられます。
                <span className="font-medium text-foreground">「バス優先」</span>にすると、バスを使う経路が上に来ます。
              </Step>
              <Step n={4} title="検索する">検索すると結果ページに移り、URLを共有すれば同じ検索結果を開けます。</Step>
            </div>
            <Tip>
              バス停は「(バス)〇〇」という名前で登録されています。駅とバス停が別々に出てくるのはそのためです。
            </Tip>
          </Section>

          {/* 2. 検索結果の見かた */}
          <Section icon={ArrowRight} title="2. 検索結果の見かた">
            <ul className="space-y-2">
              <li>
                <span className="font-medium">早・楽・短のバッジ</span>
                ：表示中の候補のうち、最も早く着く／乗換が少ない／所要時間が短いものに付きます。
              </li>
              <li>
                <span className="font-medium">「1本前 / 1本後」</span>
                ：前後の便に切り替えられます。
              </li>
              <li>
                <span className="font-medium">「○駅○分」をタップ</span>
                ：途中の停車駅を開いて確認できます。
              </li>
              <li className="flex gap-2">
                <Footprints className="h-4 w-4 shrink-0 translate-y-0.5 text-muted-foreground" />
                <span>
                  徒歩の区間は「徒歩○分 ＋ 待ち○分」と表示されます。乗り物どうしの乗り換えは3分、
                  電車⇄バスなど種類が変わる乗り換えは4分を最低時間として計算しています。
                </span>
              </li>
              <li>
                <span className="font-medium">運用番号のバッジ</span>
                ：その列車・バスの運用番号です。タップすると運営へのリクエストを送れます。走行中の列車なら
                「走行位置」リンクからその列車の現在位置を見られます。
              </li>
            </ul>
          </Section>

          {/* 3. 時刻表 */}
          <Section icon={Clock} title="3. 時刻表を見る">
            <p>
              <Link href="/timetable" className="font-medium text-green-700 underline">
                時刻表
              </Link>
              のページで駅・バス停を選ぶと、その場所の発車時刻がまとめて見られます。
            </p>
            <div className="flex gap-2 rounded-md border border-border bg-background p-3">
              <MapIcon className="h-4 w-4 shrink-0 translate-y-0.5 text-green-700" />
              <div>
                <p className="font-medium">「地図から選ぶ」</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  名前がわからないときは地図から選べます。
                  <span className="font-medium text-foreground">四角が鉄道駅、丸がバス停</span>です。
                  拡大するとすべての名前が表示されます。
                </p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              中原台・島北出坂・上砥は番線ごと、そのほかの駅は上り／下りごとにタブが分かれます。
              各タブには主な行き先も書かれているので、方面の確認に使えます。
            </p>
          </Section>

          {/* 4. 走行位置 */}
          <Section icon={Train} title="4. 今どこを走っているか見る（列車走行位置）">
            <p>
              <Link href="/live" className="font-medium text-green-700 underline">
                列車走行位置
              </Link>
              では、走っている列車・バスの現在位置が10秒ごとに自動更新されます。
            </p>
            <ul className="space-y-2">
              <li>
                <span className="font-medium">「列車」タブ</span>
                ：路線を選ぶと、縦線の左右に列車が並びます。左が上り（▲）、右が下り（▼）です。
                車両アイコンをタップすると、種別・行先・使用車両・次の停車駅と到着予想が見られます。
              </li>
              <li className="flex gap-2">
                <Bus className="h-4 w-4 shrink-0 translate-y-0.5 text-muted-foreground" />
                <span>
                  <span className="font-medium">「バス」タブ</span>
                  ：バス停を選ぶと、そのバス停に近づいているバスが「あと○停留所」と横並びで表示されます。
                  バス停は名前で検索するほか、「地図から選ぶ」でも選べます。
                </span>
              </li>
            </ul>
            <p className="text-sm text-muted-foreground">
              画面上部の「ダイヤ予測表示 / 実位置表示」は、いまどちらの情報で表示しているかを示します。
              切り替えは運営（管理者）側の設定です。
            </p>
          </Section>

          {/* 5. 運行情報・注意 */}
          <Section icon={Info} title="5. 遅れや運休を確認する">
            <p>
              <Link href="/status" className="font-medium text-green-700 underline">
                運行情報
              </Link>
              のページに、運営からのお知らせが出ます。列車の遅れは検索結果や走行位置にも表示されます
              （遅れているときだけ「+○分」と出ます）。
            </p>
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <AlertTriangle className="h-4 w-4 shrink-0 translate-y-0.5" />
              <div>
                <p className="font-medium">毎時55分ごろは運行が止まります</p>
                <p className="mt-1">
                  サーバーの再起動のため、毎時55分前後は列車・バスとも走っていません。
                  この時間帯は走行位置に何も表示されないことがあります。
                </p>
              </div>
            </div>
          </Section>

          {/* よくある質問 */}
          <Section icon={CircleHelp} title="よくある質問">
            <dl className="space-y-3">
              <div>
                <dt className="font-medium">Q. 検索しても経路が出てきません</dt>
                <dd className="mt-1 text-muted-foreground">
                  出発と到着が同じ駅（同一駅とみなす場所を含む）になっていないか、
                  時刻が最終便より後になっていないかを確認してください。
                  「手段」で徒歩やバスをオフにしていると、見つからないことがあります。
                </dd>
              </div>
              <div>
                <dt className="font-medium">Q. 地図に出ていないバス停があります</dt>
                <dd className="mt-1 text-muted-foreground">
                  位置が未登録の停留所は地図に置けないため、地図の下にボタンとして並べています。そちらから選べます。
                </dd>
              </div>
              <div>
                <dt className="font-medium">Q. 走行位置に出ていない列車があります</dt>
                <dd className="mt-1 text-muted-foreground">
                  その列車が走っていない時間帯か、運休の設定がされている可能性があります。
                  また、路線から離れた場所にいる車両は「線区に対応づかない列車」としてまとめて表示されます。
                </dd>
              </div>
            </dl>
          </Section>

          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded-md bg-green-700 px-4 py-2 text-sm font-bold text-white hover:bg-green-800"
            >
              <Search className="h-4 w-4" />
              さっそく検索する
            </Link>
            <Link
              href="/timetable"
              className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <Clock className="h-4 w-4" />
              時刻表を見る
            </Link>
            <Link
              href="/live"
              className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              <Train className="h-4 w-4" />
              走行位置を見る
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
