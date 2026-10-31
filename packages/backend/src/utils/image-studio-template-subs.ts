/**
 * 이미지 스튜디오 세부 카테고리 (★2026-10-06 Harold 지시 · 갤러리 걸러보기 전용 공개 축)
 *
 * 템플릿 본문 · 생성 프롬프트와 무관하다(`buildPosterPrompt` 는 이 값을 읽지 않는다). 카드를 고르는 길만 짧게 한다.
 * 20종 이상 카테고리만 나눈다. 그보다 작은 카테고리는 한 화면에 다 보이므로 세부가 없다(값 = null).
 * ⛔ 이 표에 있는 카테고리에 템플릿을 새로 넣으면 여기에도 배정해야 한다 · 계약 테스트(image-studio-catalog.test.ts)가 빠진 것을 막는다.
 * 배열 순서 = 화면 칩 순서.
 */
export const TEMPLATE_SUB_GROUPS: Record<string, Array<{ sub: string; ids: string[] }>> = {
  '뷰티': [
    { sub: '스킨케어', ids: ['beauty-toner-pour-dish', 'beauty-toner-cotton-shelf', 'beauty-essence-single-drop', 'beauty-essence-glass-sheets', 'beauty-serum-mirror-tray', 'beauty-ampoule-test-rack', 'beauty-serum-lightbox', 'beauty-cream-jar-swipe', 'beauty-cream-whipped-peaks', 'beauty-lotion-ribbon-slate', 'beauty-emulsion-milk-cloud', 'beauty-eye-cream-steel', 'beauty-cleansing-oil-melt', 'beauty-cleansing-foam-basin', 'beauty-sunscreen-straw-towel', 'beauty-sunscreen-swatch-acrylic', 'beauty-sheet-mask', 'beauty-eye-patch', 'beauty-toner-pad', 'beauty-balm-swirl', 'beauty-mist-cloud', 'beauty-court-sun', 'beauty-silk-pillow', 'beauty-derma-clinic', 'beauty-macro-texture', 'beauty-split-compare', 'beauty-foam-cloud', 'beauty-steam-mirror', 'beauty-baby-mild'] },
    { sub: '보습', ids: ['beauty-hydra-water-ripple', 'beauty-condensation-pane', 'beauty-barrier-layers', 'beauty-pebbles-cream-dollops', 'beauty-hydrogel-slab', 'beauty-sleeping-pack-lamp', 'beauty-hyaluronic-strands', 'beauty-dew-leaf', 'beauty-humidifier-vapor', 'beauty-body-lotion-towel', 'beauty-hand-cream-pouch', 'beauty-lip-balm-ribbon'] },
    { sub: '메이크업', ids: ['beauty-cushion-satin-open', 'beauty-foundation-drops-row', 'beauty-concealer-wand-tip', 'beauty-primer-frosted-glass', 'beauty-blush-powder-burst', 'beauty-highlighter-light-streak', 'beauty-contour-clay-lines', 'beauty-tint-glass-drip', 'beauty-lipstick-bullet-row', 'beauty-matte-lip-velvet', 'beauty-eyeshadow-crushed-pigment', 'beauty-eyeliner-stroke', 'beauty-brow-pencil-shavings', 'beauty-palette-color-mosaic', 'beauty-nude-compact-stack', 'beauty-swatch-acrylic-sheets', 'beauty-setting-powder-sift', 'beauty-makeup-brush-fan', 'beauty-cushion-glow', 'beauty-lip-oil-drip', 'beauty-mascara-macro', 'beauty-shade-range', 'beauty-palette-flatlay', 'beauty-brow-grid', 'beauty-lip-swatch', 'beauty-car-touchup', 'beauty-vanity-topdown', 'beauty-backstage-mirror'] },
    { sub: '향수', ids: ['beauty-scent-vials', 'beauty-perfume-flacon'] },
    { sub: '헤어·바디', ids: ['beauty-scalp-care', 'beauty-salon-station', 'beauty-hair-shine', 'beauty-bath-bubble', 'beauty-desk-hand', 'beauty-dental-fresh', 'beauty-nail-chips'] },
    { sub: '남성·디바이스·비건', ids: ['beauty-mens-grooming', 'beauty-device-dock', 'beauty-hanbang-tradition', 'beauty-vegan-refill'] },
    { sub: '세트·선물', ids: ['beauty-basic-trio-steps', 'beauty-refill-pouch-pair', 'beauty-mini-size-tray', 'beauty-skincare-gift-ribbon', 'beauty-sample-kit', 'beauty-duo-ribbon', 'beauty-mini-full', 'beauty-gift-unbox', 'beauty-travel-pouch', 'beauty-lineup-row', 'beauty-routine-steps', 'beauty-collab-split', 'beauty-subscription-box'] },
    { sub: '매장·후기', ids: ['beauty-tester-bar', 'beauty-drugstore-shelf', 'beauty-basket-pick', 'beauty-polaroid-review', 'beauty-hand-moment', 'beauty-morning-desk', 'beauty-renewal-compare'] },
    { sub: '고급·다크 무드', ids: ['beauty-lux-dark', 'beauty-smoke-noir', 'beauty-marble-goldfoil', 'beauty-glow-gold', 'beauty-midnight-ritual', 'beauty-antique-vanity', 'beauty-duotone-gel', 'beauty-iridescent-holo'] },
    { sub: '밝고 깨끗한 무드', ids: ['beauty-clean-bright', 'beauty-aqua-fresh', 'beauty-cotton-cloud', 'beauty-pastel-makeup', 'beauty-tile-pastel', 'beauty-summer-cooling', 'beauty-citrus-vitamin', 'beauty-jelly-cubes', 'beauty-neon-pop'] },
    { sub: '자연·소재 무드', ids: ['beauty-moss-stone', 'beauty-orchid-shadow', 'beauty-petal-water', 'beauty-botanical-lab', 'beauty-terracotta-clay', 'beauty-plaster-shapes', 'beauty-spa-natural', 'beauty-ocean-mineral', 'beauty-sphere-rise', 'beauty-underwater', 'beauty-raw-ingredients'] },
    { sub: '빛·그래픽 무드', ids: ['beauty-blind-stripes', 'beauty-glass-blocks', 'beauty-magazine-stack', 'beauty-flash-snap', 'beauty-kaleidoscope', 'beauty-acrylic-steps', 'beauty-sunset-seamless', 'beauty-gloss-puddle', 'beauty-rain-window', 'beauty-glass-refract', 'beauty-silk-drape', 'beauty-sun-shadow'] },
    { sub: '계절 무드', ids: ['beauty-spring-garden', 'beauty-autumn-amber', 'beauty-winter-frost'] },
  ],
  '패션': [
    { sub: '아우터', ids: ['fashion-coat-wall-hook', 'fashion-puffer-loft', 'fashion-trench-arch', 'fashion-leather-jacket-garage', 'fashion-denim-jacket-mint', 'fashion-cardigan-bentwood', 'fashion-blazer-valet', 'fashion-fleece-cedar', 'fashion-windbreaker-pier', 'fashion-vest-layering'] },
    { sub: '상의', ids: ['fashion-white-shirt-sheer', 'fashion-blouse-bow-blush', 'fashion-tee-pegboard', 'fashion-sweatshirt-boucle', 'fashion-hoodie-skatepark', 'fashion-knit-vest-study', 'fashion-polo-marina', 'fashion-crop-top-acrylic', 'fashion-linen-shirt-shutter', 'fashion-turtleneck-plinth'] },
    { sub: '하의·원피스', ids: ['fashion-slacks-crease', 'fashion-wide-pants-ladder', 'fashion-pleated-skirt-fan', 'fashion-mini-skirt-checker', 'fashion-shorts-locker', 'fashion-jogger-stairs', 'fashion-leggings-foamroller', 'fashion-long-skirt-sway', 'fashion-dress-rattan-terracotta', 'fashion-slip-dress-chaise', 'fashion-shirt-dress-shadow', 'fashion-knit-dress-nook', 'fashion-setup-double-hanger', 'fashion-jumpsuit-pipe-rack'] },
    { sub: '남성·키즈·홈웨어', ids: ['fashion-mens-shirt-valet-tray', 'fashion-mens-chino-workshop', 'fashion-mens-overshirt-bicycle', 'fashion-mens-suit-wardrobe', 'fashion-mens-knit-armchair', 'fashion-mens-slate-stack', 'fashion-kids-pastel-rack', 'fashion-kids-romper-muslin', 'fashion-kids-school-flatlay', 'fashion-pajama-bedside', 'fashion-robe-bathroom'] },
    { sub: '의류 상품컷', ids: ['fashion-ghost-mannequin', 'fashion-front-back-pair', 'fashion-wall-hook-trio', 'fashion-detail-trio-panels'] },
    { sub: '가방', ids: ['fashion-clutch-mirror-tray', 'fashion-ecobag-bicycle', 'fashion-wallet-walnut-tray', 'fashion-shoulder-bag-column', 'fashion-bucket-bag-rope', 'fashion-mini-bag-glassblock', 'fashion-tote-bench', 'fashion-backpack-door', 'fashion-crossbody-cafe', 'fashion-gym-bag', 'fashion-leather-goods', 'fashion-in-my-bag'] },
    { sub: '신발', ids: ['fashion-boots-entryway', 'fashion-sandals-river-stone', 'fashion-slides-terrazzo', 'fashion-running-treadmill', 'fashion-maryjane-cushion', 'fashion-mules-marble-step', 'fashion-oxford-polish-kit', 'fashion-sneaker-plinth-spot', 'fashion-heels-mirror', 'fashion-sneaker-puddle', 'fashion-loafer-library', 'fashion-kids-shoes', 'fashion-shoebox-open', 'fashion-shoes-step'] },
    { sub: '주얼리·액세서리', ids: ['fashion-gloves-felt-tray', 'fashion-muffler-loop', 'fashion-watch-slate', 'fashion-ring-sculpt', 'fashion-earring-stand', 'fashion-cap-pegs', 'fashion-sock-grid', 'fashion-scarf-sky', 'fashion-hair-acc', 'fashion-jewelry-dish', 'fashion-hatbox', 'fashion-tie-rack', 'fashion-jewelry-velvet', 'fashion-eyewear-light', 'fashion-accessory-flatlay', 'fashion-belt-buckle'] },
    { sub: '의류·코디', ids: ['fashion-innerwear-drawer', 'fashion-ootd-flatlay', 'fashion-setup-chair', 'fashion-travel-bench', 'fashion-lounge-morning', 'fashion-knit-texture', 'fashion-linen-texture', 'fashion-denim-washes', 'fashion-denim-texture', 'fashion-office-suit', 'fashion-modern-hanbok', 'fashion-kids-family', 'fashion-workwear-utility', 'fashion-gold-evening', 'fashion-coord-grid', 'fashion-colorway', 'fashion-detail-macro', 'fashion-door-outfit'] },
    { sub: '스포츠·아웃도어', ids: ['fashion-yoga-room', 'fashion-golf-bench', 'fashion-tennis-court', 'fashion-athleisure-track', 'fashion-outdoor-gear', 'fashion-sport-motion', 'fashion-bike-street'] },
    { sub: '매장·진열·케어', ids: ['fashion-walkin-closet', 'fashion-folded-stacks', 'fashion-window-mannequin', 'fashion-shopping-stairs', 'fashion-size-hangers', 'fashion-rack-lineup', 'fashion-fitting-mirror', 'fashion-parcel-open', 'fashion-boutique-spot', 'fashion-neon-window', 'fashion-alteration', 'fashion-steamer-care', 'fashion-laundromat', 'fashion-rooftop-line', 'fashion-size-flatlay', 'fashion-gift-wrap'] },
    { sub: '공방·소재', ids: ['fashion-dye-vats', 'fashion-textile-mill', 'fashion-embroidery', 'fashion-button-jar', 'fashion-vintage-trunk', 'fashion-swatch-fan', 'fashion-moodboard', 'fashion-yarn-basket', 'fashion-atelier-craft'] },
    { sub: '화보·무드', ids: ['fashion-color-cyc', 'fashion-studio-clean', 'fashion-street-urban', 'fashion-magazine-serif', 'fashion-season-lookbook', 'fashion-archive-film', 'fashion-mono-sculpt', 'fashion-after-runway', 'fashion-parisian-alley', 'fashion-motion-blur'] },
    { sub: '계절 무드', ids: ['fashion-spring-outing', 'fashion-summer-resort', 'fashion-autumn-city', 'fashion-winter-snow'] },
  ],
  '세일·이벤트': [
    { sub: '상품 추천', ids: ['sale-bestseller', 'sale-new-arrival', 'sale-for-you', 'sale-wishlist', 'sale-star-reviews', 'sale-limited-color', 'sale-pairing', 'sale-bundle-set', 'sale-year-best', 'sale-official-only'] },
    { sub: '알림', ids: ['sale-cart-mini', 'sale-price-down', 'sale-refill-time', 'sale-restock', 'sale-live-preview', 'sale-stock-gauge'] },
    { sub: '선물·감사', ids: ['sale-thanks-card', 'sale-gift-with', 'sale-gift-send', 'sale-thanks-warm', 'sale-firstbuy', 'sale-app-only', 'sale-gift-tiers'] },
    { sub: '세일 기획', ids: ['sale-bold-impact', 'sale-elegant-event', 'sale-black-gold', 'sale-festa-gift', 'sale-time-urgent', 'sale-spring-renewal', 'sale-summer-splash', 'sale-season-off', 'sale-winter-ice', 'sale-countdown-flip', 'sale-brand-week', 'sale-warehouse-clear'] },
    { sub: '뽑기·응모', ids: ['sale-mystery-box', 'sale-lucky-draw', 'sale-scratch-card', 'sale-roulette-wheel', 'sale-secret-envelope', 'sale-coupon-ticket', 'sale-attendance-check'] },
    { sub: '그래픽 스타일', ids: ['sale-neon-wire', 'sale-paper-tear', 'sale-balloon-pop', 'sale-megaphone-announce', 'sale-swiss-grid', 'sale-liquid-jelly', 'sale-stamp-press', 'sale-pixel-retro'] },
  ],
  '카페·음료': [
    { sub: '커피', ids: ['cafe-drip-drop', 'cafe-roastery', 'cafe-deep-roast', 'cafe-milk-pour', 'cafe-ice-macro', 'cafe-cream-latte', 'cafe-dripbag-set'] },
    { sub: '음료·티', ids: ['cafe-fridge-bottles', 'cafe-fruit-ade', 'cafe-tea-salon', 'cafe-matcha-zen', 'cafe-green-smoothie', 'cafe-bubble-tea'] },
    { sub: '디저트·브런치', ids: ['cafe-brunch-morning', 'cafe-dessert-sweet', 'cafe-gelato-pastel', 'cafe-donut-dozen', 'cafe-croffle-cream', 'cafe-bagel-stack', 'cafe-scone-jam', 'cafe-saltbread-tray'] },
    { sub: '케이크·선물', ids: ['cafe-whole-cake-stand', 'cafe-slice-case', 'cafe-baked-giftbox', 'cafe-cookie-jar', 'cafe-macaron-rows', 'cafe-fruit-tart', 'cafe-pudding-jars'] },
    { sub: '매장·주문', ids: ['cafe-takeout-hand', 'cafe-menu-row', 'cafe-carrier-order', 'cafe-window-bar', 'cafe-first-cup', 'cafe-wood-natural', 'cafe-night-jazz', 'cafe-rooftop-sunset', 'cafe-marble-topdown', 'cafe-terrazzo-morning', 'cafe-tumbler-goods'] },
    { sub: '계절 무드', ids: ['cafe-summer-pool', 'cafe-winter-cozy', 'cafe-spring-blossom-terrace', 'cafe-autumn-maple'] },
  ],
  '신메뉴·팝': [
    { sub: '공개 연출', ids: ['pop-vending', 'pop-delivery-open', 'pop-falling', 'pop-giant-scale', 'pop-conveyor', 'pop-curtain-reveal', 'pop-bubble-gum'] },
    { sub: '그래픽 스타일', ids: ['pop-solid-flash', 'pop-retro-block', 'pop-cute-pastel', 'pop-neon-night', 'pop-comic-burst', 'pop-vintage-print', 'pop-y2k-chrome', 'pop-picnic-checker', 'pop-sticker-collage', 'pop-graffiti-street', 'pop-pixel-arcade', 'pop-bubble-3d', 'pop-riso-print'] },
    { sub: '시즌 팝', ids: ['pop-strawberry-season', 'pop-tropical-sunset', 'pop-halloween-night', 'pop-christmas-toy'] },
  ],
  '외식·메뉴': [
    { sub: '메뉴 클로즈업', ids: ['food-steam-bowl', 'food-cross-section', 'food-sauce-pour', 'food-spice-macro', 'dine-noodle-lift', 'dine-pizza-pull', 'dine-fried-crunch', 'dine-dumpling-steamer', 'dine-ramen-topdown', 'dine-dessert-plating', 'dine-bread-oven'] },
    { sub: '분식·한 그릇', ids: ['dine-tteokbokki-pan', 'dine-kimbap-row', 'dine-jjajang-jjamppong', 'dine-tonkatsu-cut', 'dine-donburi-yolk', 'dine-bibimbap-top', 'dine-omurice-glaze'] },
    { sub: '세계 요리', ids: ['dine-burger-stack', 'dine-poke-bowl', 'dine-pasta-nest', 'dine-steak-plate', 'dine-pho-herbs', 'dine-taco-lineup', 'dine-curry-plate'] },
    { sub: '불·조리 현장', ids: ['food-grill-flame', 'dine-chef-pass', 'dine-sizzle-plate', 'dine-hotpot', 'dine-wok-fire', 'dine-bbq-table', 'dine-soup-cauldron', 'dine-seafood-steam', 'dine-galbijjim-pot', 'dine-marbled-beef', 'dine-bbq-platter'] },
    { sub: '한상·정식', ids: ['food-banchan-topdown', 'food-bento-grid', 'dine-lunch-tray', 'dine-kids-plate', 'dine-pairing-dinner', 'dine-omakase', 'dine-jokbal-platter', 'dine-sashimi-ice'] },
    { sub: '술·페어링', ids: ['dine-chicken-beer', 'dine-craft-taps', 'dine-highball-bar', 'dine-wine-board', 'dine-signature-cocktail', 'dine-jeon-makgeolli'] },
    { sub: '매장 분위기', ids: ['dine-dining-room', 'dine-private-room', 'dine-pocha-night', 'dine-terrace-table'] },
    { sub: '포장·배달', ids: ['food-delivery-bag', 'dine-takeout-spread', 'dine-catering-spread', 'dine-mealkit-box'] },
  ],
  '멤버십·고객감사': [
    { sub: '회원·등급', ids: ['event-mem-early-rack', 'event-mem-subscriber', 'event-mem-family', 'event-mem-corporate', 'event-mem-newcard', 'event-mem-chrome', 'event-mem-tierchart', 'event-mem-tierkeep', 'event-mem-welcomekit', 'event-mem-velvet', 'event-mem-merch', 'event-mem-quiet-hours', 'event-mem-firstlook', 'event-mem-earlybird'] },
    { sub: '감사·초대', ids: ['event-mem-vip-fitting', 'event-mem-skin-consult', 'event-mem-styling-day', 'event-mem-anniversary-flowers', 'event-mem-regular-seat', 'event-mem-pick-gift', 'event-mem-bouquet', 'event-mem-confetti', 'event-mem-street', 'event-mem-bigthanks', 'event-mem-dayripple', 'event-mem-lantern', 'event-mem-blackgold', 'event-mem-thanks', 'event-mem-secret', 'event-mem-weekend', 'event-mem-pinkcarpet', 'event-mem-birthday', 'event-mem-thankletter', 'event-mem-longtime', 'event-mem-repeat'] },
    { sub: '포인트·휴면 안내', ids: ['event-mem-pointexpire', 'event-mem-pointgift', 'event-mem-dormant', 'event-mem-comeback'] },
    { sub: '참여 이벤트', ids: ['event-mem-award', 'event-mem-referral', 'event-mem-review', 'event-mem-survey'] },
  ],
  '오픈·기념일': [
    { sub: '오픈', ids: ['event-open-flagship', 'event-open-beauty-lounge', 'event-open-grand', 'event-open-gallery', 'event-open-night', 'event-open-bloom', 'event-open-mirror-showroom', 'event-open-comingsoon', 'event-open-branch', 'event-open-preopen', 'event-open-online', 'event-open-counter', 'event-open-popin'] },
    { sub: '리뉴얼·이전', ids: ['event-open-renewal', 'event-open-moving', 'event-open-remodel', 'event-open-farewell'] },
    { sub: '기념일', ids: ['event-open-anniv', 'event-open-gold-anniv', 'event-open-milestone'] },
    { sub: '영업 안내', ids: ['event-open-hours', 'event-open-closed', 'event-open-access'] },
  ],
  '시즌·명절 행사': [
    { sub: '명절·절기', ids: ['event-season-gift', 'event-season-chuseok', 'event-season-sunrise', 'event-season-seollal', 'event-season-daeboreum', 'event-season-boknal', 'event-season-kimjang', 'event-season-holiday-hours', 'event-season-newyear-reset'] },
    { sub: '계절', ids: ['event-season-layering-week', 'event-season-outer-fair', 'event-season-vacation-look', 'event-season-summer', 'event-season-winter', 'event-season-autumn', 'event-season-picnic', 'event-season-cherryfest', 'event-season-monsoon', 'event-season-foliage', 'event-season-heatwave', 'event-season-firstcold', 'event-season-carechange', 'event-season-winter-kids', 'event-season-spring-preview'] },
    { sub: '연말·연휴', ids: ['event-season-party-look', 'event-season-yearend', 'event-season-blackweek', 'event-season-xmaseve', 'event-season-wedding', 'event-season-longholiday', 'event-season-backtoschool', 'event-season-beforeholiday', 'event-season-giftguide', 'event-season-holiday-edition', 'event-season-yearend-thanks'] },
  ],
  '팝업·페스티벌': [
    { sub: '팝업 스토어', ids: ['event-pop-trunk-show', 'event-pop-sample-room', 'event-pop-beauty-bar', 'event-pop-makeover-booth', 'event-pop-fitting-lounge', 'event-pop-atrium', 'event-pop-store', 'event-pop-collab', 'event-pop-neon', 'event-pop-art', 'event-pop-photobooth', 'event-pop-truck', 'event-pop-showroom', 'event-pop-finalweek'] },
    { sub: '마켓·페스티벌', ids: ['event-pop-festa', 'event-pop-market', 'event-pop-flea', 'event-pop-water', 'event-pop-bookfair', 'event-pop-pet', 'event-pop-craftlocal', 'event-pop-stamprally'] },
    { sub: '나이트·공연', ids: ['event-pop-runway', 'event-pop-foodtruck', 'event-pop-cinema', 'event-pop-camping', 'event-pop-livemusic', 'event-pop-sportsview', 'event-pop-countdown'] },
    { sub: '체험 부스', ids: ['event-pop-tasting', 'event-pop-workshop', 'event-pop-canopy'] },
  ],
  '데이·기념일': [
    { sub: '연인·선물 데이', ids: ['event-day-valentine', 'event-day-whiteday', 'event-day-roseday', 'event-day-pepero', 'event-day-black'] },
    { sub: '가족·학교', ids: ['event-day-carnation', 'event-day-children', 'event-day-newsemester', 'event-day-suneung', 'event-day-teacher', 'event-day-adult', 'event-day-examticket', 'event-day-graduation'] },
    { sub: '이색 데이', ids: ['event-day-halloween', 'event-day-advent', 'event-day-petday', 'event-day-samgyeop', 'event-day-earth', 'event-day-firstsnow', 'event-day-friendship', 'event-day-founding', 'event-day-ipchun'] },
    { sub: '월급날·주말·말일', ids: ['event-day-payday', 'event-day-weekend', 'event-day-monthend'] },
  ],
  '쇼핑몰·상품컷': [
    { sub: '흰 배경·스튜디오', ids: ['shop-white-front', 'shop-white-three-quarter', 'shop-floating-shadow', 'shop-black-mirror', 'shop-grey-rimlight', 'shop-color-match-backdrop', 'shop-turntable-plinth', 'shop-top-down-white', 'shop-hard-light-shadow'] },
    { sub: '구성·비교', ids: ['shop-whats-included', 'shop-size-reference', 'shop-color-lineup', 'shop-with-package', 'shop-bundle-stack', 'shop-open-closed-pair', 'shop-material-swatches', 'shop-option-grid'] },
    { sub: '연출 컷', ids: ['shop-desk-styled', 'shop-wall-shelf', 'shop-window-light', 'shop-fabric-drape', 'shop-stone-plinth', 'shop-water-splash', 'shop-gradient-glow', 'shop-unwrap-tissue'] },
  ],
  '신상·기획전': [
    { sub: '패션 신상', ids: ['launch-new-drop-crates', 'launch-lookbook-reveal', 'launch-capsule-rail', 'launch-palette-banners', 'launch-preorder-tag', 'launch-collab-two-walls', 'launch-limited-rope', 'launch-pattern-corkboard', 'launch-appointment-showroom', 'launch-stockroom-cart', 'launch-menswear-den', 'launch-kids-blocks', 'launch-denim-rolls', 'launch-jewel-domes'] },
    { sub: '뷰티 신상', ids: ['launch-beauty-light-beam', 'launch-beauty-renewal-paint', 'launch-beauty-pigment-mounds', 'launch-beauty-lab-bench', 'launch-beauty-ingredient-table', 'launch-beauty-teaser-mist', 'launch-beauty-sampling-table', 'launch-beauty-shade-wall', 'launch-beauty-glass-showcase', 'launch-beauty-water-rods'] },
    { sub: '온라인 기획전', ids: ['promo-category-aisle', 'promo-brand-hall', 'promo-online-exclusive', 'promo-md-pick-desk', 'promo-ranking-podium', 'promo-group-buy-conveyor', 'promo-ship-today-dock', 'promo-review-cushions', 'promo-taste-curation', 'promo-theme-table'] },
    { sub: '라이브·예약', ids: ['live-studio-set', 'live-onair-glow', 'preorder-service-bell', 'preorder-notify-bell', 'live-backstage-racks', 'live-replay-sofa'] },
  ],
};

/** 템플릿 id → 세부 카테고리. */
export const SUB_BY_ID: Record<string, string> = Object.fromEntries(
  Object.values(TEMPLATE_SUB_GROUPS).flatMap((groups) => groups.flatMap((g) => g.ids.map((id) => [id, g.sub] as const))),
);

/** 카테고리 → 세부 칩 순서(화면이 이 순서로 칩을 그린다). */
export const SUB_ORDER: Record<string, string[]> = Object.fromEntries(
  Object.entries(TEMPLATE_SUB_GROUPS).map(([cat, groups]) => [cat, groups.map((g) => g.sub)]),
);
