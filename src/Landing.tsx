import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import {
  Monitor,
  Mic,
  BookOpen,
  Search,
  List,
  User,
  ArrowRight,
  Sparkles,
  Eye,
  PenTool,
  Activity,
  Globe,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Reusable helpers                                                   */
/* ------------------------------------------------------------------ */

function SectionHeading({
  label,
  title,
  subtitle,
}: {
  label: string;
  title: string;
  subtitle?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5 }}
      className="text-center max-w-2xl mx-auto mb-16"
    >
      <span className="inline-block text-sm font-semibold tracking-widest uppercase text-teal-600 mb-3">
        {label}
      </span>
      <h2 className="text-3xl sm:text-4xl font-bold text-stone-900 tracking-tight">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-4 text-lg text-stone-500 leading-relaxed">{subtitle}</p>
      )}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Feature card                                                       */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Eye,
    title: 'Screen Awareness',
    body: 'Sees what you see. BrowserBud watches your screen and understands context\u00a0\u2014 no copy-pasting needed.',
  },
  {
    icon: PenTool,
    title: 'Smart Notes',
    body: 'Automatically captures key information, questions, and recommendations as you browse.',
  },
  {
    icon: Mic,
    title: 'Voice Conversation',
    body: 'Talk naturally. Ask questions, get answers, and have discussions about what you\u2019re looking at.',
  },
  {
    icon: Activity,
    title: 'Activity Logging',
    body: 'Keeps a running log of your browsing activity\u00a0\u2014 what you looked at, when, and key takeaways.',
  },
  {
    icon: Globe,
    title: 'Background Research',
    body: 'Searches the web for relevant info about what you\u2019re viewing, without you asking.',
  },
  {
    icon: User,
    title: 'Custom Personalities',
    body: 'Choose from different companion styles or create your own\u00a0\u2014 from academic researcher to casual buddy.',
  },
];

function FeatureCard({
  icon: Icon,
  title,
  body,
  index,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.45, delay: index * 0.1 }}
      className="group rounded-2xl border border-stone-200 bg-white p-7 hover:shadow-lg hover:shadow-stone-200/60 transition-shadow duration-300"
    >
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-600">
        <Icon size={22} strokeWidth={1.8} />
      </div>
      <h3 className="text-lg font-semibold text-stone-900 mb-2">{title}</h3>
      <p className="text-stone-500 leading-relaxed text-[15px]">{body}</p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  How-it-works step                                                  */
/* ------------------------------------------------------------------ */

const steps = [
  {
    num: '01',
    icon: Monitor,
    title: 'Share your screen',
    body: 'Click to share a browser tab or your entire screen.',
  },
  {
    num: '02',
    icon: Sparkles,
    title: 'Choose a companion',
    body: 'Pick a personality that matches your work style.',
  },
  {
    num: '03',
    icon: ArrowRight,
    title: 'Start working',
    body: 'BrowserBud watches, listens, and helps in the background.',
  },
];

function Step({
  num,
  icon: Icon,
  title,
  body,
  index,
}: {
  num: string;
  icon: React.ElementType;
  title: string;
  body: string;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -40 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.15 }}
      className="flex-1 relative"
    >
      {/* Connector line (hidden on last and on mobile) */}
      {index < steps.length - 1 && (
        <div className="hidden lg:block absolute top-8 left-[calc(50%+28px)] w-[calc(100%-56px)] h-px bg-stone-200" />
      )}
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="h-14 w-14 rounded-2xl bg-teal-600 text-white flex items-center justify-center shadow-md shadow-teal-600/20">
            <Icon size={24} strokeWidth={1.8} />
          </div>
          <span className="absolute -top-2 -right-2 text-[11px] font-bold text-teal-600 bg-teal-50 rounded-full h-6 w-6 flex items-center justify-center ring-2 ring-white">
            {num}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-stone-900 mb-1">{title}</h3>
        <p className="text-stone-500 text-[15px] leading-relaxed max-w-xs">{body}</p>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Use-case card                                                      */
/* ------------------------------------------------------------------ */

const useCases = [
  {
    icon: Search,
    title: 'Research sessions',
    body: 'Never lose a useful link or insight again.',
  },
  {
    icon: BookOpen,
    title: 'Learning new topics',
    body: 'Get real-time explanations of what you\u2019re reading.',
  },
  {
    icon: List,
    title: 'Work documentation',
    body: 'Automatic meeting notes and activity logs.',
  },
  {
    icon: Globe,
    title: 'Browsing discovery',
    body: 'Surface connections and related info you\u2019d miss.',
  },
];

function UseCaseCard({
  icon: Icon,
  title,
  body,
  index,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
  index: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, delay: index * 0.1 }}
      className="flex items-start gap-4 rounded-2xl border border-stone-200 bg-white p-6"
    >
      <div className="shrink-0 h-10 w-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
        <Icon size={20} strokeWidth={1.8} />
      </div>
      <div>
        <h3 className="font-semibold text-stone-900 mb-1">{title}</h3>
        <p className="text-stone-500 text-[15px] leading-relaxed">{body}</p>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main landing component                                             */
/* ------------------------------------------------------------------ */

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#FAFAF8] font-[DM_Sans,sans-serif] text-stone-900 overflow-x-hidden">
      {/* ---- Animated background blob ---- */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="blob absolute -top-[30%] left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full opacity-30 blur-[120px]" />
      </div>

      {/* ============================================================ */}
      {/*  NAV                                                          */}
      {/* ============================================================ */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-[#FAFAF8]/80 border-b border-stone-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 h-16">
          <a href="#" className="flex items-center gap-2 text-stone-900 font-bold text-lg tracking-tight">
            <Sparkles size={20} className="text-teal-600" />
            BrowserBud
          </a>
          <div className="hidden sm:flex items-center gap-8 text-sm text-stone-500">
            <a href="#features" className="hover:text-stone-900 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-stone-900 transition-colors">How It Works</a>
            <a href="#use-cases" className="hover:text-stone-900 transition-colors">Use Cases</a>
          </div>
          <a
            href="#"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-teal-600 px-5 py-2 text-sm font-medium text-white shadow-sm shadow-teal-600/20 hover:bg-teal-700 transition-colors"
          >
            Try It Now
          </a>
        </div>
      </nav>

      {/* ============================================================ */}
      {/*  HERO                                                         */}
      {/* ============================================================ */}
      <section className="relative max-w-4xl mx-auto px-6 pt-28 pb-24 sm:pt-36 sm:pb-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-4 py-1.5 text-xs font-semibold text-teal-700 mb-8 ring-1 ring-teal-100">
            <Sparkles size={13} /> Powered by Gemini Live API
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-[1.1] text-stone-900"
        >
          Your smartest
          <br className="hidden sm:block" />{' '}
          browsing companion
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mt-6 text-lg sm:text-xl text-stone-500 max-w-2xl mx-auto leading-relaxed"
        >
          BrowserBud watches your screen, takes notes, surfaces helpful info, and
          answers questions&nbsp;&mdash; all in the background while you work.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-full bg-teal-600 px-7 py-3 text-[15px] font-semibold text-white shadow-md shadow-teal-600/20 hover:bg-teal-700 transition-colors"
          >
            Try It Now <ArrowRight size={16} />
          </a>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 rounded-full border border-stone-300 px-7 py-3 text-[15px] font-semibold text-stone-700 hover:border-stone-400 hover:text-stone-900 transition-colors"
          >
            See How It Works
          </a>
        </motion.div>
      </section>

      {/* ============================================================ */}
      {/*  FEATURES                                                     */}
      {/* ============================================================ */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-24">
        <SectionHeading
          label="Features"
          title="Everything you need, running quietly in the background"
          subtitle="BrowserBud combines screen understanding, voice interaction, and intelligent note-taking into one seamless companion."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f, i) => (
            <FeatureCard key={f.title} {...f} index={i} />
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  HOW IT WORKS                                                 */}
      {/* ============================================================ */}
      <section id="how-it-works" className="max-w-5xl mx-auto px-6 py-24">
        <SectionHeading
          label="How It Works"
          title="Up and running in three clicks"
        />

        <div className="flex flex-col lg:flex-row gap-12 lg:gap-8">
          {steps.map((s, i) => (
            <Step key={s.title} {...s} index={i} />
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  USE CASES                                                    */}
      {/* ============================================================ */}
      <section id="use-cases" className="max-w-4xl mx-auto px-6 py-24">
        <SectionHeading
          label="Use Cases"
          title="Built for how you actually work"
          subtitle="Whether you're researching, learning, or documenting, BrowserBud adapts to your workflow."
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {useCases.map((u, i) => (
            <UseCaseCard key={u.title} {...u} index={i} />
          ))}
        </div>
      </section>

      {/* ============================================================ */}
      {/*  FOOTER                                                       */}
      {/* ============================================================ */}
      <footer className="border-t border-stone-200 mt-12">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-stone-400">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-teal-600" />
            <span className="font-medium text-stone-500">BrowserBud</span>
            <span className="hidden sm:inline">&middot;</span>
            <span>Built with Gemini Live API</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="hover:text-stone-600 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-stone-600 transition-colors">How It Works</a>
            <a href="#use-cases" className="hover:text-stone-600 transition-colors">Use Cases</a>
          </div>
        </div>
      </footer>

      {/* ---- Inline keyframe for background blob ---- */}
      <style>{`
        .blob {
          background: conic-gradient(
            from 180deg at 50% 50%,
            #0d948833 0deg,
            #f59e0b22 120deg,
            #0d948822 240deg,
            #f59e0b33 360deg
          );
          animation: blob-shift 12s ease-in-out infinite alternate;
        }
        @keyframes blob-shift {
          0% {
            transform: translateX(-50%) scale(1) rotate(0deg);
          }
          50% {
            transform: translateX(-48%) scale(1.08) rotate(15deg);
          }
          100% {
            transform: translateX(-52%) scale(0.95) rotate(-10deg);
          }
        }
      `}</style>
    </div>
  );
}
