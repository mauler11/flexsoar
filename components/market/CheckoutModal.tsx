"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/market/Modal';
import { SolanaBuyPanelRoot } from '@/components/market/PrivyBuyBridge';
import { formatMyr } from '@/components/card/format';
import type { BuyPanelListing } from './BuyPanel';
export interface BuyModalProps { listing: BuyPanelListing }
export function CheckoutButton({ listing }: BuyModalProps) {
 const [open,setOpen]=useState(false);
 return <><Button type="button" size="lg" onClick={()=>setOpen(true)}>Payment status</Button>
 {open&&<Modal onClose={()=>setOpen(false)} closeLabel="Close payment status" panelClassName="max-w-2xl"><CheckoutModal listing={listing} onClose={()=>setOpen(false)}/></Modal>}</>;
}
export function CheckoutModal({listing,onClose}:{listing:BuyPanelListing;onClose:()=>void}) {
 return <div className="flex flex-col gap-4 p-5 sm:p-6">
  <div className="flex items-center justify-between"><h2>Purchase status</h2><button type="button" onClick={onClose} aria-label="Close">Close</button></div>
  <p>Listing price: {formatMyr(listing.priceCents)}. No new payment is requested.</p>
  <SolanaBuyPanelRoot listingId={listing.id} priceCents={listing.priceCents}/>
 </div>;
}
