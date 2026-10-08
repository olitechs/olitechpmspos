import React from 'react';
import { Link } from 'react-router-dom';

const CASES = Array.from({ length: 47 }, (_, index) => ({
  number: index + 1,
  side: [1, 3, 6, 15, 17, 19, 20, 22, 24, 26, 27, 31, 33, 34, 36, 38, 40, 42, 44, 46, 47].includes(index + 1) ? 'right' : 'left',
}));

export default function PageNotFound() {
  return (
    <div className="ot404-page">
      <div className="ot404-composition" role="img" aria-label="404 page not found">
        <div className="ot404-layer ot404-shelf">
          <div className="ot404-shelf__side_left" />
          <div className="ot404-shelf__side_bottom" />

          {CASES.map(({ number, side }) => (
            <div key={number} className={`ot404-case ot404-case_${number}`}>
              <div className="ot404-case__front" />
              <div className="ot404-case__top" />
              <div className={`ot404-case__label ot404-case__label_${side}`} />
              <div className="ot404-case__right" />
              <div className="ot404-case__number">№2428506</div>
            </div>
          ))}

          <div className="ot404-glow" aria-hidden="true">
            <div className="ot404-glow__bottom" />
            <div className="ot404-glow__top" />
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index + 1} className={`ot404-glow__ball ot404-glow__ball_${index + 1}`} />
            ))}
          </div>

          <div className="ot404-shelf__side_front" />
          <div className="ot404-shelf__side_right" />
          <div className="ot404-shelf__handle_top" />
          <div className="ot404-shelf__handle_front" />
          <div className="ot404-shelf__handle_right" />
        </div>

        <div className="ot404-layer ot404-shadow" />
        <div className="ot404-layer ot404-numbers" aria-hidden="true">
          <div className="ot404-numbers__item ot404-numbers__item_1">4</div>
          <div className="ot404-numbers__item ot404-numbers__item_2">0</div>
          <div className="ot404-numbers__item ot404-numbers__item_3">4</div>
        </div>

        <div className="ot404-copy">
          <div className="ot404-copy__code">ERROR 404</div>
          <div className="ot404-copy__title">Page not found</div>
          <div className="ot404-copy__text">The page you requested doesn't exist or has moved.</div>
          <Link to="/" className="ot404-copy__link">Back to dashboard</Link>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css?family=Roboto:700');

        .ot404-page {
          min-height: 100vh;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: #F8F8F7;
          overflow: hidden;
        }

        .ot404-composition {
          position: relative;
          width: min(750px, 100%);
          height: 400px;
          background-color: #004880;
          background-image: linear-gradient(to left, #072e61, #004880);
          overflow: hidden;
          box-shadow: 0 24px 60px rgba(9, 12, 17, .16);
        }

        .ot404-layer { position: absolute; }
        .ot404-shelf { position: absolute; top: 150px; left: 250px; z-index: 10; }
        .ot404-shelf__side_left { position:absolute; top:0; left:0; width:500px; height:60px; background:#cdfffa; transform:skewY(-25deg); }
        .ot404-shelf__side_front { position:absolute; top:137px; left:0; width:70px; height:60px; background:#9dfbf3; background-image:linear-gradient(160deg,#84fff2,#2f7fb2); border:1px solid rgba(47,127,178,.5); transform:skewY(30deg); }
        .ot404-shelf__side_bottom { position:absolute; top:43px; left:36px; width:500px; height:73px; background:#7adbd5; transform:skewY(-25deg) skewX(44deg); }
        .ot404-shelf__side_right { position:absolute; top:42px; left:70px; width:500px; height:60px; background:#0b2f6c; background-image:linear-gradient(0deg,#0b2f6c,#16598b); transform:skewY(-25deg); }
        .ot404-shelf__handle_top { position:absolute; top:144px; left:17px; width:30px; height:7px; background:#5ac8d3; transform:skewY(30deg) skewX(-50deg); }
        .ot404-shelf__handle_front { position:absolute; top:149px; left:13px; width:30px; height:10px; background:#71e7e4; border:1px solid rgba(47,127,178,.5); transform:skewY(30deg); }
        .ot404-shelf__handle_right { position:absolute; top:155px; left:43px; width:6px; height:10px; background:#287caa; transform:skewY(-30deg); }

        .ot404-shadow { z-index:15; top:0; right:0; bottom:0; width:150px; height:100%; background-image:linear-gradient(to right,rgba(1,20,61,0),rgba(1,20,61,.8) 65%,rgba(1,20,61,1)); }

        .ot404-case { position:absolute; transform:translateY(0); transition:.3s transform ease-in; }
        .ot404-case:hover { transform:translateY(-5px); }
        .ot404-case__front { position:absolute; top:3px; left:0; width:70px; height:55px; background:#9d7f63; transform:skewY(25deg); }
        .ot404-case__label { position:absolute; top:-12px; left:5px; width:10px; height:7px; background:#9d7f63; transform:skewY(25deg); }
        .ot404-case__label_left { top:-12px; left:5px; }
        .ot404-case__label_right { top:12px; left:55px; }
        .ot404-case__top { position:absolute; top:0; left:2px; width:70px; height:4px; background-image:linear-gradient(to top,#e9eceb,#a3bab4 50%,#e9eceb); transform:skewY(25deg) skewX(-45deg); }
        .ot404-case__right { position:absolute; top:18px; left:69px; width:5px; height:55px; background-image:linear-gradient(to left,#e9eceb,#a3bab4 50%,#e9eceb); transform:skewY(-25deg); }
        .ot404-case__number { position:absolute; top:41px; left:10px; color:#7c664e; font-size:8px; transform-origin:top left; transform:rotate(-66deg) skewY(-25deg); }

        .ot404-case_1 { top:-85px; right:-470px; } .ot404-case_2 { top:-82px; right:-463px; } .ot404-case_3 { top:-79px; right:-456px; }
        .ot404-case_4 { top:-76px; right:-449px; } .ot404-case_5 { top:-73px; right:-442px; } .ot404-case_6 { top:-70px; right:-435px; }
        .ot404-case_7 { top:-67px; right:-428px; } .ot404-case_8 { top:-63px; right:-421px; } .ot404-case_9 { top:-59px; right:-414px; }
        .ot404-case_10 { top:-56px; right:-407px; } .ot404-case_11 { top:-53px; right:-400px; } .ot404-case_12 { top:-49px; right:-393px; }
        .ot404-case_13 { top:-46px; right:-386px; } .ot404-case_14 { top:-43px; right:-379px; } .ot404-case_15 { top:-39px; right:-372px; }
        .ot404-case_16 { top:-36px; right:-365px; } .ot404-case_17 { top:-33px; right:-358px; } .ot404-case_18 { top:-29px; right:-351px; }
        .ot404-case_19 { top:-26px; right:-344px; } .ot404-case_20 { top:-23px; right:-337px; } .ot404-case_21 { top:-19px; right:-330px; }
        .ot404-case_22 { top:-16px; right:-323px; } .ot404-case_23 { top:-13px; right:-316px; } .ot404-case_24 { top:-9px; right:-309px; }
        .ot404-case_25 { top:-6px; right:-302px; } .ot404-case_26 { top:-3px; right:-295px; } .ot404-case_27 { top:1px; right:-288px; }
        .ot404-case_28 { top:4px; right:-281px; } .ot404-case_29 { top:7px; right:-274px; } .ot404-case_30 { top:11px; right:-267px; }
        .ot404-case_31 { top:14px; right:-260px; } .ot404-case_32 { top:17px; right:-253px; } .ot404-case_33 { top:20px; right:-246px; }
        .ot404-case_34 { top:24px; right:-239px; } .ot404-case_35 { top:27px; right:-232px; } .ot404-case_36 { top:30px; right:-225px; }
        .ot404-case_37 { top:33px; right:-218px; } .ot404-case_38 { top:37px; right:-211px; } .ot404-case_39 { top:40px; right:-204px; }
        .ot404-case_40 { top:43px; right:-197px; } .ot404-case_41 { top:46px; right:-190px; } .ot404-case_42 { top:49px; right:-183px; }
        .ot404-case_43 { top:53px; right:-176px; } .ot404-case_44 { top:56px; right:-169px; } .ot404-case_45 { top:59px; right:-162px; }
        .ot404-case_46 { top:62px; right:-155px; } .ot404-case_47 { top:65px; right:-148px; }

        .ot404-glow { position:absolute; }
        .ot404-glow__bottom { position:absolute; top:60px; left:5px; width:135px; height:120px; background-image:linear-gradient(to top,rgba(132,255,242,1),rgba(132,255,242,1) 30%,rgba(132,255,242,0)); transform:perspective(120px) rotateX(-20deg); }
        .ot404-glow__top { position:absolute; top:-25px; left:7px; width:130px; height:180px; background-image:linear-gradient(to top,rgba(132,255,242,1),rgba(132,255,242,1) 20%,rgba(132,255,242,0)); transform:perspective(150px) rotateX(-20deg); }
        .ot404-glow__ball { position:absolute; top:0; left:0; width:10px; height:10px; border-radius:10px; background:#83fff2; transform:translateY(160px); }
        .ot404-glow__ball_1 { animation:ot404-fadeUp 5s infinite; animation-delay:.5s; }
        .ot404-glow__ball_2 { left:10px; width:5px; height:5px; animation:ot404-fadeUp 4s infinite; animation-delay:.8s; }
        .ot404-glow__ball_3 { left:24px; width:15px; height:15px; animation:ot404-fadeUp 9s infinite; animation-delay:.65s; }
        .ot404-glow__ball_4 { left:34px; width:8px; height:8px; animation:ot404-fadeUp 7s infinite; animation-delay:.5s; }
        .ot404-glow__ball_5 { left:57px; width:14px; height:14px; animation:ot404-fadeUp 7s infinite; animation-delay:.9s; }
        .ot404-glow__ball_6 { left:78px; width:11px; height:11px; animation:ot404-fadeUp 3s infinite; animation-delay:.3s; }
        .ot404-glow__ball_7 { left:91px; width:13px; height:13px; animation:ot404-fadeUp 8s infinite; animation-delay:.77s; }
        .ot404-glow__ball_8 { left:105px; width:7px; height:7px; animation:ot404-fadeUp 6s infinite; animation-delay:.4s; }
        .ot404-glow__ball_9 { left:113px; width:8px; height:8px; animation:ot404-fadeUp 4s infinite; animation-delay:.6s; }
        .ot404-glow__ball_10 { left:120px; width:4px; height:4px; animation:ot404-fadeUp 9s infinite; animation-delay:.92s; }

        .ot404-numbers { z-index:20; top:0; left:122px; color:#fff; font-family:'Roboto',sans-serif; font-size:200px; display:flex; }
        .ot404-numbers__item { margin:0 10px; animation:ot404-bounceUpDown 5s infinite; }
        .ot404-numbers__item_1 { animation-delay:.3s; } .ot404-numbers__item_2 { animation-duration:5.4s; animation-delay:.5s; } .ot404-numbers__item_3 { animation-delay:.3s; }

        .ot404-copy { position:absolute; z-index:30; left:50%; bottom:22px; width:min(620px,calc(100% - 40px)); transform:translateX(-50%); text-align:center; color:#fff; }
        .ot404-copy__code { font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.24em; opacity:.72; }
        .ot404-copy__title { margin-top:4px; font:700 24px/1.15 Roboto,ui-sans-serif,sans-serif; }
        .ot404-copy__text { margin-top:5px; font:500 12px/1.4 ui-sans-serif,system-ui,sans-serif; opacity:.82; }
        .ot404-copy__link { display:inline-flex; margin-top:10px; padding:8px 13px; border-radius:8px; background:#FFD300; color:#090C11; text-decoration:none; font:700 12px/1 ui-sans-serif,system-ui,sans-serif; }
        .ot404-copy__link:hover { background:#FFEE32; }

        @keyframes ot404-fadeUp { 0% { transform:translateY(160px); opacity:1; } 60% { opacity:1; } 100% { transform:translateY(-10px); opacity:0; } }
        @keyframes ot404-bounceUpDown { 0%,100% { transform:translateY(0); } 50% { transform:translateY(50px); } }

        @media (prefers-reduced-motion: reduce) {
          .ot404-case, .ot404-glow__ball, .ot404-numbers__item { animation:none !important; transition:none !important; }
        }
        @media (max-width:800px) { .ot404-composition { transform:scale(.8); } }
        @media (max-width:700px) { .ot404-composition { transform:scale(.7); } }
        @media (max-width:600px) { .ot404-composition { transform:scale(.6); } }
        @media (max-width:500px) { .ot404-composition { transform:scale(.5); } }
        @media (max-width:400px) { .ot404-composition { transform:scale(.4); } }
        @media (max-width:300px) { .ot404-composition { transform:scale(.3); } }
      `}</style>
    </div>
  );
}
