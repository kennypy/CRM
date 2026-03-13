import Link from "next/link";
import {
  Zap,
  BarChart3,
  Brain,
  Shield,
  ArrowRight,
  CheckCircle2,
  Play,
  Mail,
  Phone,
  GitBranch,
  Target,
  TrendingUp,
} from "lucide-react";

export const metadata = {
  title: "NexCRM — AI-Native Revenue OS",
  description:
    "Zero-entry CRM powered by graph relationships and AI inference. Stop doing data entry. Start closing deals.",
};

const FEATURES = [
  {
    icon: Brain,
    title: "Reality Score",
    desc: "AI scores every deal based on actual engagement, not what reps type in. See the gap between declared probability and reality.",
  },
  {
    icon: GitBranch,
    title: "Graph-First Architecture",
    desc: "Every contact, company, and deal is a node in a relationship graph. See who knows who, who influences what, and where your blind spots are.",
  },
  {
    icon: Mail,
    title: "Zero-Entry Capture",
    desc: "Emails, calls, and meetings sync automatically. No manual logging. Activities appear on deals the moment they happen.",
  },
  {
    icon: Target,
    title: "Buying Group Intelligence",
    desc: "Map champions, blockers, and evaluators. Know when your buying group is incomplete before it costs you the deal.",
  },
  {
    icon: Phone,
    title: "Built-In Outreach",
    desc: "Sequences, power dialer, and email campaigns. No separate tools. One platform for pipeline and engagement.",
  },
  {
    icon: TrendingUp,
    title: "Predictive Forecasting",
    desc: "AI-powered forecasts based on real signals, not gut feel. Anomaly detection alerts you when deals go dark.",
  },
];

const PROOF_POINTS = [
  "Replaces Salesforce + Outreach + Gong",
  "Under 5 min to first value",
  "No credit card required",
  "SOC 2 compliant architecture",
  "Stripe-powered billing",
  "14-day free trial",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Nav */}
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">NexCRM</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/demo/enter"
              className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 transition-colors hover:bg-indigo-50"
            >
              <span className="flex items-center gap-1.5">
                <Play className="h-3.5 w-3.5" />
                Try Demo
              </span>
            </Link>
            <Link
              href="/start"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Start Free Trial
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-purple-50" />
        <div className="relative mx-auto max-w-6xl px-6 pb-20 pt-24 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-700">
            <Zap className="h-3.5 w-3.5" />
            AI-Native Revenue OS
          </div>
          <h1 className="mx-auto max-w-4xl text-5xl font-extrabold leading-tight tracking-tight md:text-6xl lg:text-7xl">
            Stop doing data entry.{" "}
            <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Start closing deals.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600 md:text-xl">
            NexCRM captures every email, call, and meeting automatically. AI
            scores your deals on reality, not wishful thinking. Graph
            intelligence maps every relationship in your pipeline.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/start"
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:bg-indigo-700 hover:shadow-xl"
            >
              Start Free Trial
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/demo/enter"
              className="flex items-center gap-2 rounded-xl border-2 border-gray-200 px-8 py-3.5 text-base font-semibold text-gray-700 transition-all hover:border-indigo-300 hover:bg-indigo-50"
            >
              <Play className="h-4 w-4" />
              Try Demo — No Login Required
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
            {PROOF_POINTS.map((p) => (
              <span key={p} className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                {p}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-gray-100 bg-gray-50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Everything your revenue team needs
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              One platform. No integrations to duct-tape together.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
                  <f.icon className="h-5 w-5 text-indigo-600" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{f.title}</h3>
                <p className="text-sm leading-relaxed text-gray-600">
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-gray-100 py-24">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 p-12 text-white shadow-2xl">
            <BarChart3 className="mx-auto mb-6 h-12 w-12 opacity-80" />
            <h2 className="text-3xl font-bold">See it in action</h2>
            <p className="mx-auto mt-4 max-w-lg text-indigo-100">
              Click &quot;Try Demo&quot; to explore a fully loaded CRM instance
              with realistic pipeline data. No signup, no login, no friction.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/demo/enter"
                className="flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-base font-semibold text-indigo-700 shadow-lg transition-all hover:bg-indigo-50"
              >
                <Play className="h-4 w-4" />
                Try Demo
              </Link>
              <Link
                href="/start"
                className="flex items-center gap-2 rounded-xl border-2 border-white/30 px-8 py-3.5 text-base font-semibold text-white transition-all hover:border-white/60 hover:bg-white/10"
              >
                Start Free Trial
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="border-t border-gray-100 bg-gray-50 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              Simple, transparent pricing
            </h2>
            <p className="mt-4 text-lg text-gray-600">
              Start free. Upgrade when you&apos;re ready.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                name: "Starter",
                price: "Free",
                sub: "Up to 2 users",
                features: [
                  "250 contacts",
                  "Basic pipeline",
                  "Email sync",
                  "Activity timeline",
                ],
              },
              {
                name: "Growth",
                price: "$49",
                sub: "per user / month",
                popular: true,
                features: [
                  "Unlimited contacts",
                  "Reality Score AI",
                  "Sequences & dialer",
                  "Buying group mapping",
                  "Custom reports",
                ],
              },
              {
                name: "Enterprise",
                price: "Custom",
                sub: "Let's talk",
                features: [
                  "Everything in Growth",
                  "SSO / SAML",
                  "Custom objects",
                  "Dedicated support",
                  "SLA guarantee",
                ],
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-8 ${
                  plan.popular
                    ? "border-indigo-600 bg-white shadow-lg ring-1 ring-indigo-600"
                    : "border-gray-200 bg-white"
                }`}
              >
                {plan.popular && (
                  <span className="mb-4 inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                    Most Popular
                  </span>
                )}
                <h3 className="text-xl font-bold">{plan.name}</h3>
                <div className="mt-2">
                  <span className="text-3xl font-extrabold">{plan.price}</span>
                  {plan.sub && (
                    <span className="ml-1 text-sm text-gray-500">
                      {plan.sub}
                    </span>
                  )}
                </div>
                <ul className="mt-6 space-y-3">
                  {plan.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-sm text-gray-600"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/start"
                  className={`mt-8 block rounded-lg py-2.5 text-center text-sm font-semibold transition-colors ${
                    plan.popular
                      ? "bg-indigo-600 text-white hover:bg-indigo-700"
                      : "border border-gray-200 text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  {plan.name === "Enterprise"
                    ? "Contact Sales"
                    : "Start Free Trial"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 bg-white py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded bg-indigo-600">
                <Zap className="h-3 w-3 text-white" />
              </div>
              <span className="font-semibold">NexCRM</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <Link href="/login" className="hover:text-gray-900">
                Sign In
              </Link>
              <Link href="/register" className="hover:text-gray-900">
                Sign Up
              </Link>
              <Link href="/demo/enter" className="hover:text-gray-900">
                Demo
              </Link>
              <a href={`mailto:hello@nexcrm.io`} className="hover:text-gray-900">
                Contact
              </a>
            </div>
            <p className="text-sm text-gray-400">
              &copy; {new Date().getFullYear()} NexCRM. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Shield Icon hidden */}
      <span className="hidden">
        <Shield />
        <BarChart3 />
      </span>
    </div>
  );
}
