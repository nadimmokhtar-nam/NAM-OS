import type {Metadata,Viewport} from 'next';
import {PwaControls} from './pwa-controls';
import './design-tokens.css';
import './styles.css';
import '../public/workspace.css';
import '../public/client-review.css';
import '../public/project-planning.css';
import '../public/project-delivery.css';
import '../public/project-milestones.css';
import '../public/project-resources.css';
import '../public/task-scheduling.css';
import '../public/learning-paths.css';
import '../public/sales-workspace.css';
import '../public/team-profiles.css';
import '../public/home-announcements.css';
export const metadata:Metadata={title:'NAM OS — Studio workspace',description:'Private NAM Studio workspace',applicationName:'NAM OS',manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'NAM OS',statusBarStyle:'default'},icons:{icon:[{url:'/icons/nam-192.png',sizes:'192x192',type:'image/png'},{url:'/icons/nam-512.png',sizes:'512x512',type:'image/png'}],apple:[{url:'/icons/nam-180.png',sizes:'180x180',type:'image/png'}]}};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#f6f6f6'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><head><link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous"/></head><body><a className="skip" href="#main">Skip to content</a>{children}<PwaControls/></body></html>;}
