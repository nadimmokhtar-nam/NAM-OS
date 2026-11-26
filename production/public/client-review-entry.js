import {createClientReviewPortal} from './client-review.js';
let portal=null,root=null;
function mount(){const next=document.getElementById('client-review-app');if(!next)return Promise.resolve();if(root!==next){portal?.unmount();root=next;portal=createClientReviewPortal({root,notify(message){const target=document.getElementById('client-review-status');if(target)target.textContent=message;}});}return portal.mount();}
function unmount(){portal?.unmount();}
window.__NAM_CLIENT_REVIEW__=Object.freeze({mount,unmount});
