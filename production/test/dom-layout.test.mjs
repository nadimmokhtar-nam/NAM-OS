import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyDOMLayout} from '../public/dom-layout.js';

test('trusted layout applies bounded positions without inline HTML or arbitrary CSS',()=>{
 const valid={dataset:{layoutLeft:'25.5%',layoutTop:'8px',layoutWidth:'120px',layoutMinWidth:'24px'},style:{}},track={dataset:{layoutTrack:'2016'},style:{}},invalid={dataset:{layoutLeft:'0; background:url(https://private.invalid)',layoutTop:'calc(1px)',layoutWidth:'100001px',layoutMinWidth:'101%'},style:{}};
 applyDOMLayout({querySelectorAll:()=>[valid,track,invalid]});assert.deepEqual(valid.style,{left:'25.5%',top:'8px',width:'120px',minWidth:'24px'});assert.equal(track.style.width,'calc(var(--timeline-label-width) + 2016px)');assert.deepEqual(invalid.style,{});
});

test('persisted render markers keep full-precision click percentages and small scientific positions',()=>{
 const percent=(1/1234)*100,marker={dataset:{layoutLeft:percent+'%',layoutTop:'1e-8%'},style:{}},bounds={dataset:{layoutLeft:'1e2%',layoutTop:'0%',layoutWidth:'1E+5px',layoutMinWidth:'.5px'},style:{}};
 applyDOMLayout({querySelectorAll:()=>[marker,bounds]});
 assert.deepEqual(marker.style,{left:percent+'%',top:'1e-8%'});assert.deepEqual(bounds.style,{left:'100%',top:'0%',width:'100000px',minWidth:'0.5px'});
});

test('layout numeric parsing rejects negative, nonfinite, oversized and nonnumeric CSS values',()=>{
 const values=['-1px','-1e-8%','100.000000001%','1e6px','1e309px','NaN%','Infinitypx','1em','1px;top:0','calc(1px)','url(https://private.invalid)',' 1px','1px\n','1e+px','0.'+'0'.repeat(64)+'1%'];
 const elements=values.map(value=>({dataset:{layoutLeft:value},style:{}}));applyDOMLayout({querySelectorAll:()=>elements});
 assert(elements.every(element=>Object.keys(element.style).length===0));
});
