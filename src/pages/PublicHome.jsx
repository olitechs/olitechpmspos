import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import {
  ArrowRight, BarChart3, BedDouble, CalendarDays, Check, ChevronDown,
  Clock3, CreditCard, Globe2, Mail, Menu, MessageCircle, Phone, Play,
  ShieldCheck, Smartphone, Sparkles, Utensils, X, Zap
} from 'lucide-react';
import SocialFAB from '../components/shell/SocialFAB';

const CONTACT = {
  phone: '+254 745 043 121',
  phoneHref: 'tel:+254745043121',
  email: 'info@olitech.co.ke',
  whatsapp: 'https://wa.me/254745043121',
};

const features = [
  {
    title: 'Room Planner',
    icon: CalendarDays,
    large: true,
    desc: 'See every room against every date. Move reservations with confirmation, prevent double-booking, manage joint stays and keep your team oriented around today.',
    bullets: ['Today as the 3rd visible column', 'Drag & drop + overlap prevention', 'Payment-aware reservation bars', 'Date filter, print & daily occupancy footer'],
  },
  {
    title: 'PMS',
    icon: BedDouble,
    desc: 'One place for guests, rooms, stays and front-desk operations — from arrival through checkout.',
    bullets: ['8 room statuses', 'Direct / Booking.com / Unknown', 'Bed Only / BB / HB / FB', 'Adults + kids ages 0–17'],
  },
  {
    title: 'POS',
    icon: Utensils,
    desc: 'Run your restaurant and bar without leaving the hotel system. Keep tables, checks, KOT and room charges connected.',
    bullets: ['Open tables & checks', 'Live covers tracking', 'KOT & kitchen workflow', 'Cash, Card, M-Pesa & room charge'],
  },
  {
    title: 'M-Pesa First Billing',
    icon: CreditCard,
    large: true,
    desc: 'Collect deposits and balances the way your guests already pay. Keep folios, partial payments and room charges visible to the front desk.',
    bullets: ['M-Pesa STK push ready workflow', 'Partial-payment tracking', 'Charge restaurant bills to rooms', 'Clear paid / unpaid visibility'],
  },
  {
    title: 'Channel Manager',
    icon: Globe2,
    desc: 'Keep direct and Booking.com availability aligned, with rates and inventory managed from one operating view.',
    bullets: ['Direct + Booking.com', 'Rate plans & allotments', 'Stop-sell controls', 'Reduce manual updates'],
  },
  {
    title: 'Reports',
    icon: BarChart3,
    desc: 'Turn day-to-day activity into management insight with revenue, reservations, POS and payment reporting.',
    bullets: ['Revenue today & trends', 'Average check & payments', 'Reservation reporting', 'Exportable management data'],
  },
];

const pricing = [
  {
    name: 'Free',
    eyebrow: '7 DAYS FREE',
    subtitle: 'Basic plan',
    monthly: 'KES 0',
    annual: 'KES 0',
    note: 'for 7 days',
    features: ['Full access during trial', '5 rooms', '1 user', 'Room Planner + PMS + POS', '1GB data', 'Email support'],
    button: 'Get Started',
    style: 'muted',
  },
  {
    name: 'Professional',
    eyebrow: 'MOST POPULAR',
    subtitle: 'Ideal for growing hotels',
    monthly: 'KES 7,500',
    annual: 'KES 74,500',
    note: '/year',
    features: ['50 rooms', '10 users', 'Advanced POS + KOT', 'Channel Manager', 'Print + Joint Reservations', 'Drag & Drop + overlap prevention', 'All payment methods', 'Priority support'],
    button: 'Get Started',
    style: 'featured',
  },
  {
    name: 'Enterprise',
    eyebrow: '',
    subtitle: 'Best choice for multi-property',
    monthly: 'KES 15,000',
    annual: 'KES 149,000',
    note: '/year',
    features: ['Unlimited rooms & users', 'Multi-property', 'API access', 'Custom branding', 'Dedicated manager', '24/7 WhatsApp', 'Training & onboarding'],
    button: 'Get Started',
    style: 'muted',
  },
];

const comparison = [
  ['Room Planner + PMS', '✓', '✓', '✓'],
  ['POS + KOT', '✓', '✓', '✓'],
  ['Rooms', '5', '50', 'Unlimited'],
  ['Users', '1', '10', 'Unlimited'],
  ['Channel Manager', '—', '✓', '✓'],
  ['Multi-property', '—', '—', '✓'],
  ['API access', '—', '—', '✓'],
  ['Priority support', '—', '✓', '✓'],
];

const faqs = [
  ['What happens after the 7-day free trial?', 'Your trial gives you full access for 7 days. You can choose a paid plan when you are ready; there is no credit card required to start.'],
  ['Can I cancel anytime?', 'Yes. There is no long-term commitment. Cancel before your next billing period and your subscription will not renew.'],
  ['Do you support M-Pesa?', 'Yes. OliTechs is designed around Kenyan hospitality workflows and supports M-Pesa alongside card, cash and charge-to-room payments.'],
  ['Can I migrate data from Excel?', 'Yes. The platform supports import workflows so you can bring existing operational data into your hotel system.'],
  ['Does the system work for restaurants too?', 'Yes. POS includes tables, checks, covers, KOT, kitchen workflow, payments and room-charge posting.'],
  ['What support do I get?', 'Trial users get email support. Professional and Enterprise plans include priority support, with Enterprise also receiving dedicated management and WhatsApp support.'],
];

/* ---------- shared motion helpers ---------- */

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

function Reveal({ as = 'div', className = '', children, delay = 0, ...rest }) {
  const Comp = motion[as] || motion.div;
  return (
    <Comp
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      variants={fadeUp}
      transition={{ delay }}
      {...rest}
    >
      {children}
    </Comp>
  );
}

/** Pointer-driven 3D tilt wrapper — no extra dependencies, framer-motion only. */
function Tilt({ children, className = '', max = 10, glare = false }) {
  const ref = useRef(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, { stiffness: 180, damping: 16, mass: 0.4 });
  const sry = useSpring(ry, { stiffness: 180, damping: 16, mass: 0.4 });

  function onMove(e) {
    const rect = ref.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    ry.set(px * max * 2);
    rx.set(-py * max * 2);
  }
  function onLeave() {
    rx.set(0);
    ry.set(0);
  }

  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className={className} style={{ perspective: 1200 }}>
      <motion.div style={{ rotateX: srx, rotateY: sry, transformStyle: 'preserve-3d' }} className="relative">
        {children}
        {glare && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[24px] bg-gradient-to-br from-white/10 via-transparent to-transparent"
            style={{ transform: 'translateZ(40px)' }}
          />
        )}
      </motion.div>
    </div>
  );
}

/** Slow-drifting blurred orb used for hero/section ambience. */
function FloatOrb({ className, duration = 10, x = 20, y = 24 }) {
  return (
    <motion.div
      aria-hidden
      className={className}
      animate={{ x: [0, x, 0, -x, 0], y: [0, -y, 0, y, 0] }}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

/* ---------- building blocks ---------- */

function IconBox({ icon: Icon, className = '' }) {
  return <div className={`w-10 h-10 shrink-0 rounded-xl bg-[#FFD300] text-[#090C11] flex items-center justify-center ${className}`}><Icon className="w-5 h-5" /></div>;
}

function FactChip({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#161616] p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FFD300]/10 text-[#FFD300]"><Icon className="h-4.5 w-4.5" /></div>
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#D6D6D6]">{label}</div>
    </div>
  );
}

function ProductMock() {
  const days = ['01', '02', '03', '04', '05', '06', '07'];
  return (
    <div className="relative" style={{ transform: 'translateZ(30px)' }}>
      <div className="absolute -inset-8 rounded-[40px] bg-[#FFD300]/10 blur-3xl" />
      <div className="relative rounded-[24px] border border-white/15 bg-[#202020] p-2 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#757B81]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#757B81]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#757B81]" />
          <span className="ml-3 text-[10px] font-bold text-[#757B81]">OliTechs Grand Hotel · Room Planner</span>
        </div>
        <div className="rounded-[18px] bg-[#F5F3EF] p-3">
          <div className="grid grid-cols-[115px_repeat(7,minmax(48px,1fr))] overflow-hidden rounded-xl border border-[#D6D6D6] bg-surface text-[9px]">
            <div className="bg-[#090C11] p-2 font-bold text-foreground">SEPTEMBER 2026</div>
            {days.map((d, i) => <div key={d} className={`p-2 text-center font-bold ${i > 4 ? 'bg-[#EDEAE3]' : 'bg-[#262B32]'} text-white`}>{d}</div>)}
            <div className="border-t border-[#E5E5E5] p-2 font-bold">STANDARD GARDEN</div>
            <div className="col-span-4 border-t border-[#E5E5E5] bg-[#090C11] p-2 text-foreground">Front desk · Direct · 1A</div>
            <div className="col-span-2 border-t border-[#E5E5E5]" />
            <div className="border-t border-[#E5E5E5] bg-[#EDEAE3]" />
            <div className="border-t border-[#E5E5E5] p-2 font-bold">STANDARD OCEAN</div>
            <div className="col-span-2 border-t border-[#E5E5E5] bg-[#FFD300] p-2 font-bold text-[#090C11]">Guest stay · BB · 2A</div>
            <div className="col-span-3 border-t border-[#E5E5E5]" />
            <div className="col-span-2 border-t border-[#E5E5E5] bg-[#EDEAE3]" />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-[#090C11] p-2 text-[9px] text-foreground"><b className="text-[#FFD300]">3</b> Arrivals</div>
            <div className="rounded-lg bg-[#090C11] p-2 text-[9px] text-foreground"><b>8</b> In-House</div>
            <div className="rounded-lg bg-[#090C11] p-2 text-[9px] text-foreground"><b className="text-[#757B81]">2</b> Check-Outs</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingCard({ plan, annual }) {
  const price = annual ? plan.annual : plan.monthly;
  const isFeatured = plan.style === 'featured';
  return (
    <Tilt max={isFeatured ? 6 : 4} glare={isFeatured}>
      <div className={`relative flex flex-col rounded-2xl p-6 ${isFeatured ? 'scale-[1.02] border border-white bg-[#1E1E1E] shadow-[0_0_50px_rgba(255,211,0,0.08)]' : 'border border-white/10 bg-[#161616]'}`}>
        {plan.eyebrow && (
          <span className={`self-start rounded-full px-3 py-1 text-[10px] font-black tracking-wide ${isFeatured ? 'bg-[#FFD300] text-[#090C11]' : 'bg-white/10 text-white'}`}>
            {plan.eyebrow}
          </span>
        )}
        <h3 className="mt-5 text-xl font-black text-foreground">{plan.name}</h3>
        <p className="mt-1 text-sm text-[#757B81]">{plan.subtitle}</p>
        <div className="mt-6 flex items-end gap-2">
          <span className="text-3xl font-black tracking-tight text-foreground">{price}</span>
          <span className="pb-1 text-xs text-[#757B81]">{annual ? plan.note : plan.name === 'Free' ? plan.note : '/mo'}</span>
        </div>
        <p className="mt-1 text-[10px] text-[#757B81]">{annual ? 'Billed annually' : 'Billing monthly'}</p>
        <ul className="mt-6 flex-1 space-y-3">
          {plan.features.map(item => <li key={item} className="flex gap-2 text-sm text-[#D6D6D6]"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#FFD300]" />{item}</li>)}
        </ul>
        <Link to="/signup" className={`mt-7 block rounded-full py-3 text-center text-sm font-bold ${isFeatured ? 'bg-[#FFD300] text-[#090C11] hover:bg-[#FFD100]' : 'bg-[#262B32] text-white hover:bg-[#333533]'}`}>
          {plan.button}
        </Link>
      </div>
    </Tilt>
  );
}

export default function PublicHome() {
  const [annual, setAnnual] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollLinks = [
    ['Services', '#features'],
    ['How it works', '#how-it-works'],
    ['Contact', '#contact'],
    ['Pricing', '#pricing'],
    ['FAQ', '#faq'],
  ];

  return (
    <div id="top" className="min-h-screen overflow-x-hidden bg-[#090C11] text-foreground selection:bg-[#FFD300] selection:text-[#090C11]">
      <nav className="sticky top-0 z-50 border-b border-white/10 bg-[#090C11]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-5 sm:px-6">
          <a href="#top" className="flex shrink-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFD300] text-xs font-black text-[#090C11]">OT</span>
            <span className="hidden font-black tracking-tight sm:block">OliTechs Grand</span>
          </a>
          <div className="hidden flex-1 items-center justify-center gap-7 lg:flex">
            {scrollLinks.map(([label, href]) => <a key={label} href={href} className="text-sm text-[#A1A1AA] transition hover:text-foreground">{label}</a>)}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Link to="/signin" className="hidden px-2 py-2 text-sm font-semibold text-foreground sm:block">Sign In</Link>
            <Link to="/signup" className="rounded-full bg-[#FFD300] px-5 py-2.5 text-sm font-black text-[#090C11] hover:bg-[#FFD100]">Start Free Trial</Link>
            <button onClick={() => setMobileOpen(!mobileOpen)} className="rounded-lg p-2 text-foreground lg:hidden" aria-label="Menu">{mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {mobileOpen && <div className="border-t border-white/10 bg-[#090C11] px-5 py-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {scrollLinks.map(([label, href]) => <a key={label} href={href} onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-3 text-sm text-[#D6D6D6] hover:bg-[#262B32]">{label}</a>)}
            <Link to="/signin" className="px-3 py-3 text-sm text-foreground">Sign In</Link>
          </div>
        </div>}
      </nav>

      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-12 overflow-hidden px-5 pb-20 pt-16 sm:px-6 md:pt-24 lg:grid-cols-[1.02fr_.98fr]">
          <FloatOrb className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#FFD300]/10 blur-3xl" duration={11} x={26} y={18} />
          <FloatOrb className="pointer-events-none absolute -right-16 top-32 h-64 w-64 rounded-full bg-[#FFD300]/5 blur-3xl" duration={14} x={-18} y={22} />

          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }} className="relative">
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#1E1E1E] px-3 py-1.5 text-xs font-bold text-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-[#FFD300]" /> Kenyan-built hospitality software
            </motion.div>
            <motion.h1 variants={fadeUp} className="mt-6 max-w-3xl text-5xl font-black leading-[0.94] tracking-[-0.045em] sm:text-6xl lg:text-[64px]">
              Hotel Management, <span className="text-[#FFD300]">Simplified.</span><br />From Desk to Kitchen.
            </motion.h1>
            <motion.p variants={fadeUp} className="mt-6 max-w-xl text-base leading-7 text-[#A1A1AA] sm:text-lg">
              OliTechs replaces Excel & 3 systems. Room Planner, PMS, POS and M-Pesa billing in one yellow/black operating system built for Kenya.
            </motion.p>
            <motion.div variants={fadeUp} className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="rounded-full bg-[#FFD300] px-7 py-3.5 text-sm font-black text-[#090C11] hover:bg-[#FFD100]">Start 7-Day Free Trial <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
              <a href="#planner" className="rounded-full bg-surface px-7 py-3.5 text-sm font-bold text-[#090C11] hover:bg-[#D6D6D6]"><Play className="mr-1 inline h-4 w-4 fill-current" /> See Room Planner</a>
            </motion.div>
            <motion.p variants={fadeUp} className="mt-4 text-xs text-[#757B81]">No credit card required · Cancel anytime · Setup in 5 minutes</motion.p>
            <motion.div variants={fadeUp} className="mt-10 grid max-w-lg grid-cols-3 gap-2">
              <FactChip icon={Smartphone} label="M-Pesa Ready" />
              <FactChip icon={Zap} label="5-Min Setup" />
              <FactChip icon={Globe2} label="Built for Kenya" />
            </motion.div>
          </motion.div>

          <Reveal delay={0.15}>
            <Tilt max={9} glare>
              <ProductMock />
            </Tilt>
          </Reveal>
        </section>

        <Reveal as="section" className="mx-auto max-w-7xl px-5 pb-8 sm:px-6">
          <div className="rounded-2xl border border-white/10 bg-[#161616] p-5 sm:p-6">
            <div className="flex flex-col items-center justify-between gap-5 sm:flex-row">
              <p className="text-sm font-bold text-foreground">Talk to the team directly — no ticket queue.</p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full border border-white/10 bg-[#202020] px-4 py-2 text-xs font-black text-foreground hover:border-[#FFD300]"><MessageCircle className="h-4 w-4 text-[#FFD300]" /> WhatsApp</a>
                <a href={CONTACT.phoneHref} className="flex items-center gap-2 rounded-full border border-white/10 bg-[#202020] px-4 py-2 text-xs font-black text-foreground hover:border-[#FFD300]"><Phone className="h-4 w-4 text-[#FFD300]" /> {CONTACT.phone}</a>
                <a href={`mailto:${CONTACT.email}`} className="flex items-center gap-2 rounded-full border border-white/10 bg-[#202020] px-4 py-2 text-xs font-black text-foreground hover:border-[#FFD300]"><Mail className="h-4 w-4 text-[#FFD300]" /> {CONTACT.email}</a>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" id="features" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">Benefits</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Everything to run your hotel, nothing you don't.</h2>
            <p className="mt-4 text-[#A1A1AA]">One operating layer for rooms, guests, restaurant, payments and management.</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ title, icon, desc, bullets, large }, i) => {
              const Icon = icon;
              return (
                <Reveal as="article" delay={(i % 3) * 0.06} id={title === 'Room Planner' ? 'planner' : title === 'POS' ? 'pos' : undefined} key={title} className={large ? 'lg:col-span-2' : ''}>
                  <Tilt max={5}>
                    <div className="rounded-2xl border border-white/10 bg-[#161616] p-6 transition hover:border-white/20">
                      <IconBox icon={Icon} />
                      <h3 className="mt-5 text-xl font-black">{title}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#A1A1AA]">{desc}</p>
                      <div className="mt-5 grid gap-2 sm:grid-cols-2">
                        {bullets.map(b => <div key={b} className="flex items-start gap-2 text-xs text-[#D6D6D6]"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FFD300]" />{b}</div>)}
                      </div>
                      {title === 'M-Pesa First Billing' && <div className="mt-6 flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#FFD300] px-3 py-1.5 text-xs font-black text-[#090C11]">PARTIALLY PAID · 50%</span><span className="text-xs text-[#757B81]">M-Pesa → Folio → Receipt</span></div>}
                    </div>
                  </Tilt>
                </Reveal>
              );
            })}
          </div>
        </Reveal>

        <section className="border-y border-white/5 bg-[#0D0D0D] py-24" id="how-it-works">
          <div className="mx-auto max-w-7xl px-5 sm:px-6">
            <Reveal className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">How it works?</p>
              <h2 className="mt-3 text-3xl font-black sm:text-4xl">Get started in 3 simple steps</h2>
              <p className="mt-3 text-[#A1A1AA]">Go from signup to running your operation without a long implementation project.</p>
            </Reveal>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {[
                ['01', 'Create Account', 'Sign up, start your 7-day free trial and invite your team. No card required.'],
                ['02', 'Add Rooms & Tables', 'Import rooms, create room types and set up your POS floor plan.'],
                ['03', 'Start Selling', 'Check in guests, take orders, post room charges and collect M-Pesa.'],
              ].map(([n, t, d], i) => (
                <Reveal key={n} delay={i * 0.08} className="rounded-2xl border border-white/10 bg-[#161616] p-6">
                  <div className="text-4xl font-black text-[#FFD300]">{n}</div>
                  <h3 className="mt-5 text-lg font-black">{t}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#A1A1AA]">{d}</p>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <Reveal as="section" id="pricing" className="mx-auto max-w-7xl px-5 py-24 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex rounded-full border border-white/10 bg-surface/10 px-3 py-1 text-xs font-bold">Pricing</span>
            <h2 className="mt-4 text-4xl font-black tracking-tight">Choose your plan</h2>
            <p className="mt-3 text-[#A1A1AA]">Start small. Upgrade when your operation grows.</p>
            <div className="mx-auto mt-7 inline-flex rounded-full bg-[#1E1E1E] p-1">
              <button onClick={() => setAnnual(false)} className={`rounded-full px-5 py-2 text-xs font-bold ${!annual ? 'bg-white text-[#090C11]' : 'text-[#A1A1AA]'}`}>Monthly</button>
              <button onClick={() => setAnnual(true)} className={`rounded-full px-5 py-2 text-xs font-bold ${annual ? 'bg-white text-[#090C11]' : 'text-[#A1A1AA]'}`}>Annual <span className="ml-1 text-[#FFD300]">Save 17%</span></button>
            </div>
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl gap-5 lg:grid-cols-3">
            {pricing.map(plan => <PricingCard key={plan.name} plan={plan} annual={annual} />)}
          </div>
          <p className="mt-8 text-center text-xs text-[#757B81]">No credit card required · Cancel anytime</p>

          <div className="mt-16 overflow-hidden rounded-2xl border border-white/10 bg-[#161616]">
            <div className="border-b border-white/10 px-5 py-5"><h3 className="font-black">Compare plans</h3><p className="mt-1 text-xs text-[#757B81]">Everything important, side by side.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[650px] text-sm">
                <thead><tr className="border-b border-white/10 text-left text-[#757B81]"><th className="px-5 py-4 font-semibold">Feature</th><th className="px-5 py-4">Free</th><th className="px-5 py-4 text-foreground">Professional</th><th className="px-5 py-4">Enterprise</th></tr></thead>
                <tbody>{comparison.map(row => <tr key={row[0]} className="border-b border-white/5 last:border-0"><td className="px-5 py-3.5 text-[#D6D6D6]">{row[0]}</td>{row.slice(1).map((v, i) => <td key={i} className={`px-5 py-3.5 ${v === '✓' ? 'font-black text-[#FFD300]' : 'text-[#757B81]'}`}>{v}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="mx-auto max-w-7xl px-5 pb-24 sm:px-6">
          <div className="rounded-2xl border border-white/10 bg-[#161616] p-8 sm:p-10">
            <div className="flex flex-col items-center justify-between gap-8 lg:flex-row">
              <div><p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">Integrations</p><h2 className="mt-2 text-2xl font-black">Payments your guests already trust.</h2><p className="mt-2 text-sm text-[#A1A1AA]">M-Pesa, cards, cash and charge-to-room in one billing workflow.</p></div>
              <div className="flex flex-wrap gap-3">
                {['M-PESA', 'CARD', 'CASH', 'KRA'].map(x => <div key={x} className="rounded-xl border border-white/10 bg-[#202020] px-5 py-3 text-xs font-black text-foreground">{x}</div>)}
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal as="section" className="mx-auto max-w-7xl px-5 pb-24 sm:px-6">
          <div className="grid items-center gap-10 lg:grid-cols-[.8fr_1.2fr]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">Why OliTechs?</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Stop stitching your hotel together with spreadsheets.</h2>
              <p className="mt-4 text-sm leading-6 text-[#A1A1AA]">Excel can store information. OliTechs connects the operation — rooms, guests, tables, payments and management — so your team can act on the same live picture.</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#161616]">
              <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-white/10 bg-[#202020] px-5 py-4 text-xs font-black uppercase tracking-wide">
                <span>Operation</span><span className="text-[#757B81]">Excel + tools</span><span className="text-[#FFD300]">OliTechs</span>
              </div>
              {[
                ['Room availability', 'Manual updates', 'Live Room Planner'],
                ['Guest + folio', 'Separate files', 'Connected PMS'],
                ['Restaurant orders', 'Separate POS', 'POS + KOT'],
                ['M-Pesa billing', 'Manual reconciliation', 'Connected payments'],
                ['Management reports', 'Build your own', 'Ready-to-use reports'],
              ].map(row => <div key={row[0]} className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-white/5 px-5 py-4 text-sm last:border-0"><span className="text-[#D6D6D6]">{row[0]}</span><span className="text-[#757B81]">{row[1]}</span><span className="font-bold text-foreground">{row[2]}</span></div>)}
            </div>
          </div>
        </Reveal>

        <section id="contact" className="mx-auto max-w-7xl px-5 pb-24 sm:px-6">
          <Reveal className="text-center">
            <p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">Get in touch</p>
            <h2 className="mt-3 text-3xl font-black">Talk to OliTechs directly</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-[#A1A1AA]">Questions about setup, pricing or migrating from Excel? Reach the team through any of these channels.</p>
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              { icon: MessageCircle, label: 'WhatsApp', value: CONTACT.phone, href: CONTACT.whatsapp, external: true },
              { icon: Phone, label: 'Call', value: CONTACT.phone, href: CONTACT.phoneHref },
              { icon: Mail, label: 'Email', value: CONTACT.email, href: `mailto:${CONTACT.email}` },
            ].map((c, i) => {
              const Icon = c.icon;
              return (
                <Reveal key={c.label} delay={i * 0.08}>
                  <Tilt max={6}>
                    <a href={c.href} target={c.external ? '_blank' : undefined} rel={c.external ? 'noreferrer' : undefined} className="block rounded-2xl border border-white/10 bg-[#161616] p-6 transition hover:border-[#FFD300]/40">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFD300] text-[#090C11]"><Icon className="h-5 w-5" /></div>
                      <p className="mt-5 text-xs font-black uppercase tracking-[0.15em] text-[#757B81]">{c.label}</p>
                      <p className="mt-1 text-lg font-black text-foreground">{c.value}</p>
                    </a>
                  </Tilt>
                </Reveal>
              );
            })}
          </div>
          <Reveal delay={0.2} className="mt-6 flex items-center justify-center gap-2 text-xs text-[#757B81]">
            <Clock3 className="h-3.5 w-3.5 text-[#FFD300]" /> Fastest response is usually via WhatsApp.
          </Reveal>
        </section>

        <Reveal as="section" id="faq" className="mx-auto max-w-3xl px-5 pb-24 sm:px-6">
          <div className="text-center"><p className="text-xs font-black uppercase tracking-[0.22em] text-[#FFD300]">FAQ</p><h2 className="mt-3 text-3xl font-black">Frequently Asked Questions</h2></div>
          <div className="mt-9 space-y-3">
            {faqs.map(([q, a], i) => <div key={q} className="rounded-xl border border-white/10 bg-[#161616]">
              <button className="flex w-full items-center justify-between gap-5 px-5 py-4 text-left text-sm font-bold" onClick={() => setOpenFaq(openFaq === i ? null : i)}>
                <span>{q}</span><ChevronDown className={`h-4 w-4 shrink-0 text-[#FFD300] transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === i && <div className="border-t border-white/10 px-5 pb-5 pt-4 text-sm leading-6 text-[#A1A1AA]">{a}</div>}
            </div>)}
          </div>
        </Reveal>

        <Reveal as="section" className="mx-auto max-w-7xl px-5 pb-24 sm:px-6">
          <div className="rounded-3xl bg-[#FFD300] p-10 text-center sm:p-14">
            <Sparkles className="mx-auto h-7 w-7 text-[#090C11]" />
            <h2 className="mt-4 text-3xl font-black tracking-tight text-[#090C11] sm:text-4xl">Ready to run your hotel like a 5-star?</h2>
            <p className="mt-3 text-sm font-semibold text-[#262B32]">Built for hotels and lodges in Kenya.</p>
            <Link to="/signup" className="mt-7 inline-flex items-center rounded-full bg-[#090C11] px-8 py-4 text-sm font-black text-foreground hover:bg-[#262B32]">Start Your 7-Day Free Trial <ArrowRight className="ml-2 h-4 w-4" /></Link>
            <p className="mt-4 text-xs font-semibold text-[#333533]">No credit card · Cancel anytime · Setup in 5 mins</p>
          </div>
        </Reveal>
      </main>

      <footer className="border-t border-white/10 bg-[#090C11]">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFD300] text-xs font-black text-[#090C11]">OT</span><span className="font-black">OliTechs Grand</span></div>
            <p className="mt-4 max-w-xs text-sm leading-6 text-[#757B81]">The yellow/black operating system for modern African hospitality.</p>
            <div className="mt-5 flex items-center gap-2 text-xs text-[#757B81]"><ShieldCheck className="h-4 w-4 text-[#FFD300]" /> Built for hospitality operations</div>
          </div>
          <div><h3 className="text-sm font-bold">Menu</h3><div className="mt-4 space-y-3 text-sm text-[#A1A1AA]"><a className="block hover:text-foreground" href="#features">Features</a><a className="block hover:text-foreground" href="#pricing">Pricing</a><a className="block hover:text-foreground" href="#how-it-works">How it works</a><a className="block hover:text-foreground" href="#faq">FAQ</a></div></div>
          <div><h3 className="text-sm font-bold">Legal & Contact</h3><div className="mt-4 space-y-3 text-sm text-[#A1A1AA]"><a className="block hover:text-foreground" href="#">Terms</a><a className="block hover:text-foreground" href="#">Privacy</a><a className="block hover:text-foreground" href={CONTACT.phoneHref}>{CONTACT.phone}</a><a className="block hover:text-foreground" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></div></div>
          <div>
            <h3 className="text-sm font-bold">Stay in the loop</h3><p className="mt-4 text-sm leading-6 text-[#757B81]">Product updates and hospitality tips. No spam.</p>
            <form onSubmit={e => e.preventDefault()} className="mt-4 flex gap-2"><input aria-label="Email" type="email" placeholder="you@hotel.com" className="min-w-0 flex-1 rounded-full border border-white/10 bg-[#161616] px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-[#757B81] focus:border-[#FFD300]" /><button className="shrink-0 rounded-full bg-[#FFD300] px-4 py-2.5 text-xs font-black text-[#090C11] hover:bg-[#FFD100]">Subscribe</button></form>
          </div>
        </div>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 border-t border-white/10 px-5 py-6 text-center sm:px-6 md:flex-row md:text-left">
          <p className="text-xs text-[#757B81]">© 2026 OliTechs. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs">
            <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="font-black text-[#FFD300] hover:text-foreground"><MessageCircle className="mr-1 inline h-4 w-4" />Designed by Shadrack — WhatsApp {CONTACT.phone}</a>
          </div>
        </div>
      </footer>

      <SocialFAB />
    </div>
  );
}
