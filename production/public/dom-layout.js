// The production CSP permits trusted scripts, not HTML style attributes.
// Only bounded lengths cross this boundary; URLs, expressions and CSS text do not.
export function applyDOMLayout(root){
 if(!root?.querySelectorAll)return;
 const properties=[['layoutLeft','left'],['layoutTop','top'],['layoutWidth','width'],['layoutMinWidth','minWidth']];
 for(const element of root.querySelectorAll('[data-layout-left],[data-layout-top],[data-layout-width],[data-layout-min-width],[data-layout-track]')){
  if(!element.style)continue;
  for(const [attribute,property]of properties){
   const value=element.dataset?.[attribute];if(typeof value!=='string'||value.length>64)continue;
   const match=value.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d{1,3})?)(px|%)$/);if(!match||match[0]!==value)continue;
   const number=Number(match[1]);if(!Number.isFinite(number)||number<0||number>(match[2]==='%'?100:100000))continue;
   element.style[property]=number+match[2];
  }
  const track=element.dataset?.layoutTrack;
  if(typeof track==='string'&&/^\d{1,6}$/.test(track)&&Number(track)>0&&Number(track)<=100000)element.style.width='calc(var(--timeline-label-width) + '+Number(track)+'px)';
 }
}
