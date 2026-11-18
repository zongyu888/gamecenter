// Patch credits overlay: a small "i" button, bottom left, that toggles the game's credits.
// Fill C below (scripts/fork.mjs does it). The source is plain text: the sandbox blocks new tabs.
(() => {
	const C = {
		title: 'Harrowfield',
		author: 'Blendi Bylygbashi',
		license: 'Code MIT. Arms and weapons: 12 animated first-person models by DJMaesen (bumstrum), CC BY 4.0 (sketchfab.com/bumstrum), adapted (converted, compressed, clips cut, materials and framing changed, Stormjar jar added). Zombies and their animation: Adobe Mixamo (in-game use). The farm and every room: made for this game, with images from GPT Image 2.5, models from Meshy 7.1 and upscaling with ESRGAN (via fal.ai), built and baked in Blender. Earlier textures and props: Poly Haven (CC0); wallpapers, rugs, paintings, stove, dresser and tonic cabinets made with Nano Banana Pro and Meshy (via fal.ai). Fonts: IM Fell English by Igino Marini (OFL 1.1). Sounds: ElevenLabs, Mirelo, Sonilo, Stable Audio, ACE-Step (via fal.ai), Sonniss GDC bundle (in-game use), Freesound and Kenney (CC0). Libraries: three.js (MIT), Rapier (Apache-2.0), postprocessing (Zlib), navcat and mathcat (MIT), meshoptimizer (MIT). Full list with links in CREDITS.md.',
		source: 'Made for Patch (source private)',
		added: 'Added to Patch by Blendi Bylygbashi.',
	};
	const root = document.createElement('div');
	root.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;pointer-events:none;font:13px/1.4 system-ui,sans-serif;color:#eef';
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.textContent = 'i';
	btn.setAttribute('aria-label', 'Credits');
	btn.style.cssText = 'pointer-events:auto;width:24px;height:24px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(10,16,24,.45);color:#fff;font:italic 600 14px/22px Georgia,serif;padding:0;cursor:pointer;opacity:.55';
	const panel = document.createElement('div');
	panel.hidden = true;
	panel.style.cssText = 'pointer-events:auto;position:absolute;left:0;bottom:32px;width:280px;padding:10px 12px;border-radius:8px;background:rgba(10,16,24,.88);border:1px solid rgba(255,255,255,.18);user-select:text';
	const line = (text, css) => {
		const p = document.createElement('div');
		p.textContent = text;
		if (css) p.style.cssText = css;
		panel.appendChild(p);
	};
	line(C.title, 'font-weight:700;font-size:15px');
	line('by ' + C.author);
	line('License: ' + C.license);
	line('Source: ' + C.source, 'word-break:break-all');
	line(C.added, 'margin-top:6px;opacity:.7');
	btn.addEventListener('click', () => {
		panel.hidden = !panel.hidden;
		btn.style.opacity = panel.hidden ? '.55' : '1';
	});
	btn.addEventListener('mouseenter', () => (btn.style.opacity = '1'));
	btn.addEventListener('mouseleave', () => (btn.style.opacity = panel.hidden ? '.55' : '1'));
	const stop = (e) => e.stopPropagation();
	for (const el of [btn, panel])
		for (const t of ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'pointermove', 'mousemove', 'wheel', 'contextmenu', 'touchstart', 'touchend'])
			el.addEventListener(t, stop);
	btn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); btn.click(); } });
	root.append(panel, btn);
	(document.body || document.documentElement).appendChild(root);
})();
