(function(){
const $=id=>document.getElementById(id);
if(matchMedia("(pointer:fine)").matches){const c=$("cur");let on=false;
  document.addEventListener("pointermove",e=>{if(!on){on=true;c.style.display="block";document.documentElement.classList.add("nc")}c.style.transform=`translate(${e.clientX}px,${e.clientY}px)`});
  document.addEventListener("mouseleave",()=>c.style.display="none");document.addEventListener("mouseenter",()=>{if(on)c.style.display="block"})}
document.addEventListener("pointerdown",e=>{const r=document.createElement("span");r.className="rip";r.style.left=e.clientX+"px";r.style.top=e.clientY+"px";
  const h=Math.floor(Math.random()*360);r.style.background=`radial-gradient(circle,hsla(${h},90%,60%,.55),hsla(${(h+60)%360},90%,60%,.25))`;document.body.appendChild(r);setTimeout(()=>r.remove(),750)});
})();
