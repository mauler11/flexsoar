"use client";
import { SolanaBuyPanel } from './SolanaBuyPanel';
/** Paused recovery depends on account identity, not wallet linking/provider. */
export function SolanaBuyPanelRoot(props:{listingId:string;priceCents:number}) {return <SolanaBuyPanel {...props}/>;}
