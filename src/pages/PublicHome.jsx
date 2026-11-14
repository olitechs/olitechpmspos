import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Check, ChevronDown, ChevronRight, Menu, X } from 'lucide-react';
import SocialFAB from '../components/shell/SocialFAB';
import BrandLogo from '@/components/ui/BrandLogo';

const CONTACT = {
  phone: '+254 745 043 121',
  phoneHref: 'tel:+254745043121',
  email: 'info@olitechs.co.ke',
  whatsapp: 'https://wa.me/254745043121',
  // Email domain spelling and any social profiles still need owner
  // confirmation — see docs/OPEN_QUESTIONS.md.
};

const plans = [
  {
    name: 'Free Trial',
    eyebrow: '7-DAY ACCESS',
    price: 'KES 0',
    period: '7 days',
    description: 'Experience the power of connected hospitality management.',
    features: [
      '7-day platform access',
      'PMS and POS exploration',
      'Room and reservation management',
      'Front Office dashboard',
      'Restaurant POS access',
      'Basic reporting',
      'Guided onboarding',
    ],
    action: 'Start Free Trial',
    tone: 'blue',
  },
  {
    name: 'Professional',
    eyebrow: 'PMS + POS',
    price: 'KES 7,500',
    period: 'per month',
    description: 'Everything a growing hospitality business needs to operate efficiently.',
    features: [
      'Complete hotel PMS',
      'Front Office operations',
      'Room Planner and reservations',
      'Guest Folio and billing',
      'Restaurant and bar POS',
      'Kitchen Display System',
      'Inventory management',
      'Priority support',
    ],
    action: 'Get Started',
    tone: 'featured',
  },
  {
    name: 'Enterprise',
    eyebrow: 'ADVANCED OPERATIONS',
    price: 'KES 15,000',
    period: 'per month',
    description: 'Advanced tools for larger hospitality businesses and complex operations.',
    features: [
      'Everything in Professional',
      'Advanced reporting and analytics',
      'Multi-department operations',
      'Advanced staff permissions',
      'Advanced inventory controls',
      'Business performance insights',
      'Dedicated onboarding assistance',
      'Enterprise configuration support',
    ],
    action: 'Choose Enterprise',
    tone: 'dark',
  },
];

const faqs = [
  ['What is OliTechs PMS + POS?', 'A hospitality management platform that brings property management and point of sale into one connected workspace for your team.'],
  ['Is it suitable for my hospitality business?', 'OliTechs is designed for hotels, boutique stays, resorts, lodges, restaurants and bars.'],
  ['Can my front desk and restaurant work together?', 'Yes. Restaurant orders can be connected to guest stays and room charges, helping your teams work from the same operational picture.'],
  ['How do I get pricing for my property?', 'Choose a plan above or contact our team to discuss the right setup for your property and operations.'],
  ['What happens during a product demo?', 'We walk through the workflows that matter to your property, including reservations, room operations, restaurant service and billing.'],
];

function Eyebrow({ children, light = false }) {
  return <p className={`text-[10px] font-extrabold uppercase tracking-[.24em] ${light ? 'text-[var(--mkt-blue-300)]' : 'text-[var(--brand-blue)]'}`}>{children}</p>;
}

function SectionTitle({ eyebrow, title, description, light = false, centered = false }) {
  return (
    <div className={`${centered ? 'mx-auto text-center' : ''} max-w-2xl`}>
      <Eyebrow light={light}>{eyebrow}</Eyebrow>
      <h2 className={`mt-4 text-[clamp(2rem,4vw,3.35rem)] font-extrabold leading-[1.02] tracking-[-.045em] ${light ? 'text-[var(--brand-white)]' : 'text-[var(--brand-navy)]'}`}>{title}</h2>
      {description && <p className={`mt-5 text-sm leading-7 sm:text-base ${light ? 'text-[var(--mkt-on-dark-muted)]' : 'text-[var(--mkt-muted)]'}`}>{description}</p>}
    </div>
  );
}

function WorkspacePreview() {
  const rooms = [
    ['101', 'Deluxe king', 'Reserved · 2 nights', 'stay-blue'],
    ['102', 'Deluxe king', 'Occupied', 'stay-green'],
    ['103', 'Garden suite', 'Reserved · 4 nights', 'stay-teal'],
    ['104', 'Twin room', 'Group booking · 3 rooms', 'stay-gold'],
  ];
  return (
    <div className="workspace-shell">
      <div className="workspace-top"><span className="window-dots"><i/><i/><i/></span><b>olitechs / property workspace</b><span className="secure-label">● Secure workspace</span></div>
      <div className="workspace-body">
        <aside className="workspace-side">
          <div className="workspace-brand">oli<span>techs</span></div>
          <small>Sample property</small><small>Coastal Kenya　⌄</small>
          {['Overview', 'Reservations', 'Front desk', 'Room planner', 'Point of sale', 'Housekeeping', 'Reports & insights'].map((item, i) => <div key={item} className={i === 3 ? 'side-active' : ''}>{item}</div>)}
          <small className="side-foot">PROPERTY WORKSPACE</small>
        </aside>
        <div className="workspace-main">
          <div className="workspace-heading"><div><b>Room planner</b><p>A clear view of every room. A warm welcome for every guest.</p></div><button>+ New reservation</button></div>
          <div className="metric-grid">
            <div><small>Occupancy</small><strong>84%</strong><em>↑ 6.2% this week</em></div>
            <div><small>Rooms available</small><strong>12</strong><em>Ready for your next guest</em></div>
            <div><small>Arrivals today</small><strong>18</strong><em>8 checked in</em></div>
            <div><small>Revenue today</small><strong>KES 286,400</strong><em>Rooms + restaurant</em></div>
          </div>
          <div className="planner-toolbar"><b>October 2026</b><span>‹　Today　 ›</span><small>● Confirmed　 ● Checked in　 ● Available</small></div>
          <div className="planner-grid">
            <div className="planner-head"><span>Room</span>{['Mon 19','Tue 20','Wed 21','Thu 22','Fri 23','Sat 24','Sun 25'].map(x => <span key={x}>{x}</span>)}</div>
            {rooms.map((room, i) => <div className="planner-row" key={room[0]}><b>{room[0]}　{room[1]}</b><span className={i === 0 ? room[3] : ''}>{i === 0 ? room[2] : ''}</span><span className={i === 1 ? room[3] : ''}>{i === 1 ? room[2] : ''}</span><span className={i === 2 ? room[3] : ''}>{i === 2 ? room[2] : ''}</span><span className={i === 3 ? room[3] : ''}>{i === 3 ? room[2] : ''}</span><span/><span/><span/></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function POSPreview() {
  const products = [
    ['SIGNATURE', 'Grilled tilapia', 'KES 1,200'],
    ['KITCHEN', 'Beef burger', 'KES 950'],
    ['FRESH', 'Garden salad', 'KES 700'],
    ['BARISTA', 'House coffee', 'KES 350'],
    ['BAR', 'Fresh juice', 'KES 450'],
    ['DESSERT', 'Chocolate cake', 'KES 600'],
  ];
  return (
    <div className="pos-preview">
      <div className="pos-window"><div className="pos-window-top"><span>OliTechs POS</span><span>Restaurant</span><b>Shift open ●</b></div>
        <div className="pos-content"><div className="pos-menu"><div className="pos-tabs">All items　 Food　 Drinks　 Desserts</div><div className="pos-products">{products.map(([tag, name, price]) => <div className="pos-product" key={name}><small>{tag}</small><b>{name}</b><strong>{price}</strong></div>)}</div></div>
          <div className="pos-order"><small>TABLE 08</small><b>2 guests · Dine in</b><hr/><p>2 × Grilled tilapia <strong>2,400</strong></p><p>1 × Garden salad <strong>700</strong></p><p>2 × Fresh juice <strong>900</strong></p><hr/><b className="order-total">Total <strong>KES 4,000</strong></b><button>Charge to room →</button></div>
        </div>
      </div>
      <p className="pos-caption">A connected bill. A smoother guest experience.</p>
    </div>
  );
}

function AnalyticsPreview() {
  return <div className="analytics-card"><div className="preview-heading"><b>Revenue overview</b><span>This week⌄</span></div><strong>KES 1,842,600</strong><div className="bar-chart">{[35,52,43,70,58,88,76].map((v,i)=><i key={i} style={{height:`${v}%`}} />)}</div><div className="chart-days">Mon　　 Tue　　 Wed　　 Thu　　 Fri　　 Sat　　 Sun</div></div>;
}

function HousekeepingPreview() {
  return <div className="housekeeping-card"><div className="preview-heading"><b>Housekeeping</b><span>Live room status</span></div>{[['101','Deluxe king','Ready'],['102','Deluxe king','In progress'],['103','Garden suite','Ready']].map(([n,room,status])=><div className="housekeeping-row" key={n}><b>{n}</b><span>{room}</span><em className={status === 'Ready' ? 'ready' : 'progress'}>{status}</em></div>)}</div>;
}

export default function PublicHome() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const updateHeader = () => setIsScrolled(window.scrollY > 12);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
    return () => window.removeEventListener('scroll', updateHeader);
  }, []);

  // Reveal homepage content as it enters the viewport.
  useEffect(() => {
    const root = document.querySelector('.olitechs-marketing');
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets = root.querySelectorAll(
      '.industry-strip > *, .connected-inner > *, .connected-list article, .solution-card, .confidence-grid > *, .plan-card, .journey-grid article, .faq-item, .final-cta > *'
    );
    if (!('IntersectionObserver' in window)) return;
    targets.forEach((element, index) => {
      element.classList.add('marketing-reveal');
      element.style.transitionDelay = `${(index % 4) * 85}ms`;
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -48px 0px' });
    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const nav = [['Platform','#platform'],['Solutions','#solutions'],['Features','#features'],['Pricing','#pricing'],['About','#about']];
  return (
    <div className="olitechs-marketing min-h-screen overflow-x-hidden bg-[var(--brand-white)] text-[var(--brand-navy)]">
      <style>{`
        .olitechs-marketing{overflow-x:clip;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
        .olitechs-marketing button,.olitechs-marketing a{transition:all .2s ease}
        .marketing-reveal{opacity:0;transform:translate3d(0,28px,0);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1);will-change:opacity,transform}
        .marketing-reveal.is-visible{opacity:1;transform:translate3d(0,0,0);will-change:auto}
        .marketing-nav{height:76px;position:sticky;top:0;z-index:50;border-bottom:1px solid transparent;background:transparent;backdrop-filter:blur(0);-webkit-backdrop-filter:blur(0);box-shadow:0 0 0 transparent;transition:background-color .28s ease,backdrop-filter .28s ease,-webkit-backdrop-filter .28s ease,border-color .28s ease,box-shadow .28s ease}
        .marketing-nav.is-scrolled{background:var(--mkt-nav-bg);backdrop-filter:blur(16px) saturate(150%);-webkit-backdrop-filter:blur(16px) saturate(150%);border-bottom-color:var(--mkt-line);box-shadow:0 8px 28px var(--mkt-shadow)}
        .marketing-nav-inner{max-width:1280px;height:100%;margin:auto;padding:0 28px;display:flex;align-items:center;gap:38px}
        .marketing-nav-links{display:flex;align-items:center;justify-content:center;gap:36px;flex:1}
        .marketing-nav-links a{font-size:13px;font-weight:600;color:var(--mkt-body)}.marketing-nav-links a:hover{color:var(--brand-blue)}
        .marketing-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;border-radius:6px;background:var(--brand-blue);padding:13px 22px;color:var(--brand-white);font-size:12px;font-weight:800;box-shadow:0 8px 20px var(--mkt-shadow)}
        .marketing-button:hover{background:var(--brand-blue-hover);transform:translateY(-1px)}
        .marketing-button-outline{border:1px solid var(--mkt-line-strong);background:var(--brand-white);color:var(--brand-navy);box-shadow:none}
        .hero-section{max-width:1280px;margin:auto;padding:78px 28px 60px;text-align:center;position:relative;isolation:isolate;overflow:hidden;background:var(--brand-navy)}
        .hero-background{position:absolute;inset:0;z-index:-2;width:100%;height:100%;object-fit:cover;object-position:center 45%;pointer-events:none}
        .hero-overlay{position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,color-mix(in srgb, var(--brand-navy) 88%, transparent),color-mix(in srgb, var(--brand-navy) 92%, transparent) 58%,color-mix(in srgb, var(--brand-navy) 97%, transparent));pointer-events:none}
        .hero-section>.hero-kicker,.hero-section>.hero-title,.hero-section>.hero-copy,.hero-section>.hero-actions,.hero-section>.workspace-wrap{position:relative;z-index:1}
        .hero-kicker{display:inline-flex;align-items:center;gap:9px;color:var(--mkt-on-dark);background:var(--mkt-white-10);border:1px solid var(--mkt-white-24);border-radius:99px;padding:8px 14px;font-size:10px;font-weight:800;letter-spacing:.15em;backdrop-filter:blur(8px)}
        .hero-title{max-width:950px;margin:25px auto 18px;font-size:clamp(42px,6vw,76px);line-height:.99;letter-spacing:-.06em;font-weight:850;color:var(--brand-white)}
        .hero-title span{color:var(--mkt-blue-300)}
        .hero-copy{max-width:680px;margin:0 auto;color:var(--mkt-on-dark);font-size:16px;line-height:1.8}
        .hero-actions{display:flex;justify-content:center;gap:12px;margin-top:27px;flex-wrap:wrap}
        .hero-subcopy{margin-top:15px;color:var(--mkt-muted-soft);font-size:11px}
        .workspace-wrap{max-width:1200px;margin:55px auto 0;text-align:left}
        .workspace-shell{border:1px solid var(--mkt-line-strong);border-radius:13px;overflow:hidden;background:var(--brand-white);box-shadow:0 25px 70px var(--mkt-shadow)}
        .workspace-top{height:43px;display:flex;align-items:center;padding:0 16px;gap:15px;background:var(--brand-white);border-bottom:1px solid var(--mkt-line-soft);color:var(--mkt-muted);font-size:10px}
        .window-dots{display:flex;gap:5px}.window-dots i{width:7px;height:7px;border-radius:50%;background:var(--mkt-line-strong)}
        .secure-label{margin-left:auto;color:var(--mkt-muted)}
        .workspace-body{display:grid;grid-template-columns:190px 1fr;min-height:390px}
        .workspace-side{background:var(--brand-navy);color:var(--mkt-on-dark);padding:20px 14px;display:flex;flex-direction:column;gap:9px;font-size:11px}
        .workspace-brand{font-size:20px;font-weight:900;letter-spacing:-1px;color:var(--brand-white);margin-bottom:15px}.workspace-brand span{color:var(--mkt-blue-300)}
        .workspace-side small{font-size:9px;color:var(--mkt-on-dark-muted)}.workspace-side>div:not(.workspace-brand){padding:9px 10px;border-radius:5px;color:var(--mkt-on-dark)}.workspace-side .side-active{background:var(--brand-blue);color:var(--brand-white)!important}.workspace-side .side-foot{margin-top:auto;letter-spacing:.14em}
        .workspace-main{padding:20px 22px;min-width:0}.workspace-heading{display:flex;justify-content:space-between;align-items:center;gap:15px}.workspace-heading b{font-size:14px}.workspace-heading p{font-size:10px;color:var(--mkt-muted-soft);margin-top:4px}.workspace-heading button{background:var(--brand-blue);color:var(--brand-white);border-radius:4px;padding:9px 12px;font-size:9px;font-weight:700}
        .metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.metric-grid>div{border:1px solid var(--mkt-line-soft);border-radius:6px;padding:12px;display:flex;flex-direction:column;gap:6px}.metric-grid small{font-size:9px;color:var(--mkt-muted)}.metric-grid strong{font-size:clamp(14px,2vw,23px);color:var(--brand-navy)}.metric-grid em{font-size:8px;color:var(--mkt-blue-muted);font-style:normal}
        .planner-toolbar{display:flex;align-items:center;gap:20px;margin:19px 0 10px;font-size:10px;color:var(--mkt-body)}.planner-toolbar small{margin-left:auto;font-size:8px;color:var(--mkt-muted-soft)}
        .planner-grid{border:1px solid var(--mkt-line-soft);border-radius:6px;overflow:hidden}.planner-head,.planner-row{display:grid;grid-template-columns:150px repeat(7,minmax(0,1fr));min-width:680px}.planner-head{background:var(--mkt-panel);color:var(--mkt-muted);font-size:8px;font-weight:700}.planner-head span,.planner-row>*{padding:10px 7px;border-right:1px solid var(--mkt-line-soft)}.planner-row{min-height:44px;border-top:1px solid var(--mkt-line-soft);font-size:8px;color:var(--mkt-body)}.planner-row>b{color:var(--mkt-ink-2)}.planner-row span:not(:empty){margin:5px 2px;padding:7px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.stay-blue{background:var(--mkt-blue-tint);color:var(--mkt-blue-text)}.stay-green{background:var(--mkt-green-soft);color:var(--mkt-green-text)}.stay-purple{background:var(--mkt-blue-tint);color:var(--mkt-blue-text)}.stay-gold{background:var(--mkt-amber-wash);color:var(--mkt-amber-text)}
        .industry-strip{max-width:1200px;margin:0 auto;padding:12px 28px 56px;display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center}.industry-strip div{font-size:13px;font-weight:750;color:var(--mkt-ink-2)}.industry-strip div:nth-child(2){color:var(--brand-blue)}
        .connected-section{background:var(--brand-navy);color:var(--brand-white);padding:100px 28px}.connected-inner{max-width:1224px;margin:auto;display:grid;grid-template-columns:.8fr 1.2fr;gap:70px;align-items:center}.connected-list{margin-top:38px;display:grid;gap:24px}.connected-list article{display:grid;grid-template-columns:38px 1fr;gap:14px}.connected-list article>span{font-size:13px;color:var(--mkt-blue-300);font-weight:800}.connected-list h3{font-size:16px;font-weight:750}.connected-list p{margin-top:6px;color:var(--mkt-on-dark-muted);font-size:12px;line-height:1.7}
        .pos-preview{min-width:0}.pos-window{border-radius:12px;background:var(--brand-white);color:var(--brand-navy);overflow:hidden;box-shadow:0 24px 60px var(--mkt-shadow-strong)}.pos-window-top{padding:16px 18px;display:flex;align-items:center;gap:20px;border-bottom:1px solid var(--mkt-line-soft);font-size:11px;font-weight:800}.pos-window-top span:first-child{color:var(--brand-blue)}.pos-window-top b{margin-left:auto;color:var(--mkt-green-text);font-size:9px}.pos-content{display:grid;grid-template-columns:1.25fr .75fr;gap:16px;padding:17px}.pos-tabs{font-size:9px;color:var(--mkt-muted);padding:10px 0 15px;border-bottom:1px solid var(--mkt-line-soft)}.pos-products{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;padding-top:13px}.pos-product{min-height:90px;border:1px solid var(--mkt-line-soft);border-radius:7px;padding:11px;display:flex;flex-direction:column;gap:8px}.pos-product small{font-size:7px;letter-spacing:.13em;color:var(--brand-blue);font-weight:900}.pos-product b{font-size:10px}.pos-product strong{font-size:9px;color:var(--mkt-muted)}.pos-order{border:1px solid var(--mkt-line-soft);border-radius:8px;padding:14px;font-size:9px}.pos-order>small{color:var(--brand-blue);font-weight:900;letter-spacing:.13em}.pos-order>b{display:block;margin:6px 0 12px}.pos-order p{display:flex;justify-content:space-between;gap:8px;margin:12px 0;color:var(--mkt-muted)}.pos-order hr{border:0;border-top:1px solid var(--mkt-line-soft);margin:12px 0}.pos-order .order-total{display:flex;justify-content:space-between;font-size:11px}.pos-order button{width:100%;margin-top:15px;padding:11px;background:var(--brand-blue);color:var(--brand-white);border-radius:5px;font-size:9px;font-weight:800}.pos-caption{text-align:right;margin-top:13px;color:var(--mkt-on-dark-muted);font-size:10px}
        .solutions-section{max-width:1280px;margin:auto;padding:100px 28px}.solutions-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:45px}.solution-card{min-height:210px;padding:26px;border-radius:10px;border:1px solid var(--mkt-line);background:var(--mkt-blue-wash);position:relative}.solution-card:nth-child(2){background:var(--mkt-green-wash)}.solution-card:nth-child(3){background:var(--mkt-blue-wash)}.solution-card .solution-no{font-size:10px;font-weight:900;color:var(--brand-blue)}.solution-card h3{margin-top:23px;font-size:19px;font-weight:800;letter-spacing:-.03em}.solution-card p{margin-top:10px;font-size:12px;line-height:1.7;color:var(--mkt-muted);max-width:300px}.solution-card small{display:block;margin-top:20px;font-size:8px;letter-spacing:.1em;color:var(--mkt-muted);font-weight:800}.solution-arrow{position:absolute;right:23px;top:23px;color:var(--brand-blue)}
        .confidence-section{background:var(--brand-canvas);padding:95px 28px}.confidence-inner{max-width:1224px;margin:auto}.confidence-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:42px}.analytics-card,.housekeeping-card{background:var(--brand-white);border:1px solid var(--mkt-line);border-radius:10px;padding:22px;box-shadow:0 8px 25px var(--mkt-shadow)}.preview-heading{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--mkt-ink-2)}.preview-heading span{font-size:9px;color:var(--mkt-muted-soft)}.analytics-card>strong{display:block;font-size:24px;margin-top:20px}.bar-chart{height:125px;display:flex;align-items:end;gap:17px;border-bottom:1px solid var(--mkt-line-soft);margin-top:10px;padding:0 15px}.bar-chart i{flex:1;max-width:32px;border-radius:3px 3px 0 0;background:var(--mkt-blue-bright)}.chart-days{font-size:8px;color:var(--mkt-muted-soft);text-align:center;padding-top:10px}.housekeeping-row{display:grid;grid-template-columns:50px 1fr 90px;gap:10px;align-items:center;padding:19px 0;border-bottom:1px solid var(--mkt-line-soft);font-size:10px}.housekeeping-row:last-child{border:0}.housekeeping-row span{color:var(--mkt-muted)}.housekeeping-row em{font-style:normal;font-size:9px;text-align:center;border-radius:20px;padding:6px;background:var(--mkt-green-soft);color:var(--mkt-green-text)}.housekeeping-row em.progress{background:var(--mkt-amber-wash);color:var(--mkt-amber-text)}
        .pricing-section{max-width:1280px;margin:auto;padding:100px 28px}.pricing-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;margin-top:45px;align-items:stretch}.plan-card{border:1px solid var(--mkt-line);border-radius:10px;background:var(--brand-white);padding:27px;display:flex;flex-direction:column;min-width:0}.plan-card.featured{border:2px solid var(--mkt-blue-bright);box-shadow:0 16px 40px var(--mkt-shadow)}.plan-card.dark{border-color:var(--brand-navy)}.plan-eyebrow{font-size:9px;letter-spacing:.14em;font-weight:900;color:var(--brand-blue)}.plan-card h3{margin-top:17px;font-size:20px;font-weight:800}.plan-price{margin-top:17px;font-size:30px;font-weight:900;letter-spacing:-.05em}.plan-period{font-size:11px;color:var(--mkt-muted)}.plan-description{min-height:48px;margin-top:13px;color:var(--mkt-muted);font-size:11px;line-height:1.65}.plan-features{display:grid;gap:12px;margin:24px 0 28px;flex:1}.plan-features li{display:flex;align-items:flex-start;gap:9px;color:var(--mkt-body);font-size:10px;line-height:1.45}.plan-features svg{width:13px;height:13px;flex:none;color:var(--mkt-blue-bright)}.plan-card.dark .plan-eyebrow,.plan-card.dark .plan-features svg{color:var(--brand-navy)}.plan-action{width:100%;border-radius:5px;padding:12px 14px;text-align:center;font-size:10px;font-weight:900;background:var(--brand-blue);color:var(--brand-white)}.plan-card.dark .plan-action{background:var(--brand-navy)}.plan-card.featured .plan-action{background:var(--brand-blue)}.compare-toggle{margin-top:25px;border:1px solid var(--mkt-line);border-radius:7px;padding:15px 18px;display:flex;justify-content:space-between;align-items:center;font-size:11px;font-weight:800}.pricing-help{text-align:center;margin-top:24px;font-size:11px;color:var(--mkt-muted)}.pricing-help a{color:var(--brand-blue);font-weight:800}
        .journey-section{background:var(--brand-canvas);padding:95px 28px}.journey-inner{max-width:1224px;margin:auto}.journey-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;margin-top:40px}.journey-grid article{padding:23px 0;border-top:1px solid var(--mkt-line-strong)}.journey-grid strong{font-size:12px;color:var(--brand-blue)}.journey-grid h3{margin-top:30px;font-size:16px;font-weight:800}.journey-grid p{margin-top:10px;color:var(--mkt-muted);font-size:11px;line-height:1.7}
        .faq-section{max-width:1224px;margin:auto;padding:95px 28px}.faq-layout{display:grid;grid-template-columns:.7fr 1.3fr;gap:70px}.faq-aside p{margin-top:18px;color:var(--mkt-muted);font-size:12px}.faq-item{border-bottom:1px solid var(--mkt-line)}.faq-item button{width:100%;display:flex;justify-content:space-between;gap:15px;text-align:left;padding:18px 0;font-size:12px;font-weight:800;color:var(--mkt-ink-2)}.faq-item>p{padding:0 28px 18px 0;font-size:11px;line-height:1.7;color:var(--mkt-muted)}
        .final-cta{max-width:1224px;margin:0 auto 65px;padding:34px 45px;border-radius:10px;background:linear-gradient(110deg,var(--brand-navy),var(--mkt-blue-deep));color:var(--brand-white);display:flex;align-items:center;justify-content:space-between;gap:25px}.final-cta h2{font-size:clamp(22px,3vw,34px);font-weight:850;line-height:1.05;letter-spacing:-.04em}.final-cta p{margin-top:10px;color:var(--mkt-on-dark-muted);font-size:11px}.final-cta-actions{display:grid;gap:9px;min-width:210px}.final-cta-actions a{background:var(--brand-white);color:var(--brand-navy);padding:12px 18px;border-radius:5px;text-align:center;font-size:10px;font-weight:900}.final-cta-actions a+ a{background:var(--mkt-blue-bright);color:var(--brand-white)}
        .marketing-footer{border-top:1px solid var(--mkt-line-soft);padding:45px 28px 22px}.footer-inner{max-width:1224px;margin:auto;display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:35px}.footer-inner h4{font-size:10px;font-weight:900;color:var(--mkt-ink-2)}.footer-inner a,.footer-inner p{display:block;margin-top:13px;font-size:10px;line-height:1.6;color:var(--mkt-muted)}.footer-bottom{max-width:1224px;margin:35px auto 0;padding-top:18px;border-top:1px solid var(--mkt-line-soft);display:flex;justify-content:space-between;gap:15px;color:var(--mkt-muted-soft);font-size:9px}
        @media(prefers-reduced-motion:reduce){.marketing-reveal,.marketing-reveal.is-visible{opacity:1;transform:none;transition:none;will-change:auto}}
        @media(max-width:900px){.marketing-nav-inner{gap:15px;padding:0 18px}.marketing-nav-links{gap:15px}.connected-inner{grid-template-columns:1fr;gap:38px}.workspace-body{grid-template-columns:145px 1fr}.workspace-side{padding:15px 10px}.workspace-main{padding:15px}.planner-toolbar small{display:none}.solutions-grid{gap:12px}.solution-card{padding:20px}.footer-inner{grid-template-columns:1fr 1fr}.faq-layout{gap:35px}}
        @media(max-width:640px){.marketing-nav{height:66px}.marketing-nav-inner{padding:0 15px}.marketing-nav-inner>.marketing-button{padding:10px 12px;font-size:10px}.marketing-nav-links{display:none}.mobile-nav-panel{position:absolute;top:65px;left:0;right:0;background:var(--brand-white);border-bottom:1px solid var(--mkt-line);padding:12px 18px;display:grid;gap:3px;box-shadow:0 12px 22px var(--mkt-shadow)}.mobile-nav-panel a{padding:12px 8px;font-size:13px;color:var(--mkt-body)}.hero-section{padding:55px 17px 42px}.hero-title{font-size:43px}.hero-copy{font-size:13px}.workspace-wrap{margin-top:35px;overflow:hidden}.workspace-shell{width:760px;transform:scale(.72);transform-origin:top left;margin-bottom:-105px;width:138.9%}.workspace-body{grid-template-columns:150px 1fr}.industry-strip{padding:10px 18px 45px;grid-template-columns:1fr 1fr;gap:22px 12px}.industry-strip div{font-size:11px}.connected-section,.solutions-section,.confidence-section,.pricing-section,.journey-section,.faq-section{padding:68px 18px}.connected-inner{gap:30px}.pos-content{grid-template-columns:1fr}.pos-order{max-width:none}.pos-products{grid-template-columns:repeat(2,1fr)}.pos-window-top{gap:9px;font-size:9px}.solutions-grid,.confidence-grid,.pricing-grid,.journey-grid{grid-template-columns:1fr}.solution-card{min-height:180px}.plan-card{padding:23px}.plan-description{min-height:0}.faq-layout{grid-template-columns:1fr;gap:25px}.faq-aside h2{max-width:350px}.final-cta{margin:0 18px 45px;padding:28px 22px;display:block}.final-cta-actions{margin-top:22px}.footer-inner{grid-template-columns:1fr 1fr;gap:28px 18px}.footer-inner>div:first-child{grid-column:1/-1}.footer-bottom{flex-direction:column;align-items:flex-start}.workspace-main{min-width:560px}}
        @media(prefers-reduced-motion:reduce){.olitechs-marketing *{scroll-behavior:auto!important;transition:none!important}}
      `}</style>

      <header className={`marketing-nav${isScrolled ? " is-scrolled" : ""}`}>
        <div className="marketing-nav-inner">
          <Link to="/" aria-label="OliTechs home" className="shrink-0"><BrandLogo className="h-9 w-auto max-w-[135px] object-contain object-left" /></Link>
          <nav className="marketing-nav-links">{nav.map(([label,href])=><a key={label} href={href}>{label}</a>)}</nav>
          <div className="ml-auto flex items-center gap-4">
            <Link to="/signin" className="hidden text-xs font-bold text-[var(--mkt-ink-2)] sm:inline">Sign in</Link>
            <a className="marketing-button" href="#contact">Request a Demo</a>
            <button className="rounded-md p-2 text-[var(--brand-navy)] md:hidden" onClick={()=>setMobileOpen(v=>!v)} aria-label="Toggle navigation">{mobileOpen?<X size={19}/>:<Menu size={19}/>}</button>
          </div>
        </div>
        {mobileOpen&&<nav className="mobile-nav-panel md:hidden">{nav.map(([label,href])=><a key={label} href={href} onClick={()=>setMobileOpen(false)}>{label}</a>)}<Link to="/signin">Sign in</Link></nav>}
      </header>

      <main>
        <section className="hero-section" id="platform">
          <div className="hero-overlay" aria-hidden="true" />
          <div className="hero-kicker">BUILT FOR HOSPITALITY. READY FOR WHAT’S NEXT.</div>
          <h1 className="hero-title">Great stays start with<br/><span>smarter operations.</span></h1>
          <p className="hero-copy">One connected PMS + POS for your rooms, restaurants and people.<br/>Less friction behind the scenes. Better experiences out front.</p>
          <div className="hero-actions"><a href="#contact" className="marketing-button">Request a Demo <ArrowRight size={15}/></a><a href="#features" className="marketing-button marketing-button-outline">Explore the Platform <ArrowDown size={14}/></a></div>
          <div className="workspace-wrap"><WorkspacePreview/></div>
        </section>

        <div className="industry-strip" aria-label="Designed for hospitality teams"><div>Hotels &amp; resorts</div><div>Restaurants &amp; bars</div><div>Front office</div><div>Finance &amp; operations</div></div>

        <section className="connected-section" id="features">
          <div className="connected-inner">
            <div><Eyebrow light>CONNECTED BY DESIGN</Eyebrow><h2 className="mt-4 text-[clamp(2.1rem,4vw,3.5rem)] font-extrabold leading-[1.02] tracking-[-.05em]">Your entire property.<br/>Finally in sync.</h2><p className="mt-5 max-w-sm text-sm leading-7 text-[var(--mkt-on-dark-muted)]">From the first reservation to the final bill, keep every team and every touchpoint on the same page.</p>
              <div className="connected-list">
                <article><span>01</span><div><h3>A clear front desk</h3><p>Manage bookings, room assignments and guest check-ins from one clear workspace.</p></div></article>
                <article><span>02</span><div><h3>Service without the silos</h3><p>Connect restaurant orders and room charges without losing the details.</p></div></article>
                <article><span>03</span><div><h3>Clarity at every close</h3><p>Bring sales and property activity together for a more informed end of day.</p></div></article>
              </div>
            </div>
            <POSPreview/>
          </div>
        </section>

        <section className="solutions-section" id="solutions">
          <SectionTitle eyebrow="MADE FOR YOUR WORLD" title={<>Hospitality isn’t one-size-fits-all.<br/>Your platform shouldn’t be either.</>} />
          <div className="solutions-grid">
            {[['01','Hotels & boutique stays','Make every arrival feel effortless.','Bring reservations, front desk and room readiness into one connected rhythm.','ROOMS READY WHEN YOU ARE'],['02','Resorts & lodges','Deliver a more connected escape.','Keep accommodation, dining and guest services working beautifully together.','ONE STAY. EVERY TOUCHPOINT.'],['03','Restaurants & bars','Keep great service flowing.','Move from order to payment with less friction, at the table or at the counter.','FROM FIRST ORDER TO FINAL BILL']].map(([n,title,lead,desc,foot])=><article className="solution-card" key={n}><span className="solution-no">{n}</span><ArrowRight className="solution-arrow" size={17}/><h3>{title}</h3><p>{lead} {desc}</p><small>{foot}</small></article>)}
          </div>
        </section>

        <section className="confidence-section" id="about">
          <div className="confidence-inner"><SectionTitle eyebrow="LESS GUESSWORK. MORE CONTROL." title="See the details. Move with confidence." description="A clear view of your business. Turn daily activity into a more informed next move."/>
            <div className="confidence-grid"><AnalyticsPreview/><HousekeepingPreview/></div>
          </div>
        </section>

        <section className="pricing-section" id="pricing">
          <SectionTitle eyebrow="SIMPLE, TRANSPARENT PRICING" title={<>The right tools for every stage<br/>of your hospitality business.</>} description="Choose a plan that fits your property. From getting started to managing complete hospitality operations, OliTechs brings everything together in one platform." centered/>
          <div className="pricing-grid">{plans.map(plan=><article key={plan.name} className={`plan-card ${plan.tone}`}><span className="plan-eyebrow">{plan.eyebrow}</span><h3>{plan.name}</h3><div className="plan-price">{plan.price}</div><div className="plan-period">{plan.period}</div><p className="plan-description">{plan.description}</p><div className="mt-5 text-[9px] font-extrabold tracking-[.13em] text-[var(--mkt-ink-2)]">WHAT’S INCLUDED</div><ul className="plan-features">{plan.features.map(item=><li key={item}><Check/>{item}</li>)}</ul><Link to="/signup" className="plan-action">{plan.action}</Link></article>)}</div>
          <button className="compare-toggle" onClick={()=>document.getElementById('plan-help')?.scrollIntoView({behavior:'smooth',block:'center'})}><span>Compare Plans &amp; Features</span><ChevronRight size={16}/></button>
          <p className="pricing-help" id="plan-help">Need help choosing the right plan? Our team can help you find the best fit for your hospitality operation.　<a href="#contact">Talk to Our Team</a></p>
        </section>

        <section className="journey-section" id="how-it-works"><div className="journey-inner"><SectionTitle eyebrow="A SMARTER WAY FORWARD" title="Your next chapter, without the complexity." description="A clear path from first conversation to a more connected property."/><div className="journey-grid">{[['01','Let’s talk hospitality.','Show us how your business runs and what you want to improve.'],['02','See your workflows.','Explore PMS + POS through a demo built around your needs.'],['03','Plan your next move.','Find the right setup for your property, your team and your goals.']].map(([n,t,d])=><article key={n}><strong>{n}</strong><h3>{t}</h3><p>{d}</p></article>)}</div></div></section>

        <section className="faq-section" id="faq"><div className="faq-layout"><div className="faq-aside"><SectionTitle eyebrow="A LITTLE MORE CLARITY" title={<>Good questions.<br/>Clear answers.</>}/><p>Have something else in mind?<br/><a className="font-extrabold text-[var(--brand-blue)]" href="#contact">Let’s talk ↗</a></p></div><div>{faqs.map(([q,a],i)=><article className="faq-item" key={q}><button onClick={()=>setOpenFaq(openFaq===i?-1:i)} aria-expanded={openFaq===i}><span>{q}</span>{openFaq===i?<ChevronDown size={17}/>:<ChevronRight size={17}/>}</button>{openFaq===i&&<p>{a}</p>}</article>)}</div></div></section>

        <section className="final-cta" id="contact"><div><Eyebrow light>MAKE ROOM FOR WHAT’S NEXT</Eyebrow><h2 className="mt-4">Complete hotel management.<br/>Better guest experiences.</h2><p>Discover what a more connected property can look like.</p></div><div className="final-cta-actions"><a href={CONTACT.whatsapp} target="_blank" rel="noreferrer">Request a Demo ↗</a><Link to="/signup">Get Started →</Link></div></section>
      </main>

      <footer className="marketing-footer"><div className="footer-inner"><div><BrandLogo className="h-9 w-auto max-w-[130px] object-contain object-left"/><p className="max-w-xs">Smarter operations.<br/>More memorable hospitality.</p></div><div><h4>Platform</h4><a href="#platform">Property management</a><a href="#solutions">Point of sale</a><a href="#features">Features</a><a href="#pricing">Pricing</a></div><div><h4>Solutions</h4><a href="#solutions">Hotels &amp; resorts</a><a href="#solutions">Restaurants &amp; bars</a><a href="#contact">Request a Demo</a><Link to="/signin">Sign in</Link></div><div><h4>Company</h4><a href="#about">About OliTechs</a><a href={CONTACT.whatsapp}>Contact</a><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a><a href={CONTACT.phoneHref}>{CONTACT.phone}</a></div></div><div className="footer-bottom"><span>© 2026 OliTechs. All rights reserved.</span><span className="flex gap-4"><Link to="/terms" className="hover:underline">Terms</Link><Link to="/privacy" className="hover:underline">Privacy</Link></span><span>olitechs.co.ke</span></div></footer>
      <SocialFAB/>
    </div>
  );
}