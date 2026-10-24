export interface IssuerRateLimiter {
  take(key:string,limit:number,windowSeconds:number,nowSeconds:number):number|null;
}

/** Process-local best-effort limits. They reduce accidental load; D7 and DB guards remain authoritative. */
export function createIssuerRateLimiter():IssuerRateLimiter{
  const events=new Map<string,number[]>();
  return {take(key,limit,windowSeconds,nowSeconds){
    const floor=nowSeconds-windowSeconds;
    const recent=(events.get(key)??[]).filter(t=>t>floor);
    if(recent.length>=limit){events.set(key,recent);return Math.max(1,recent[0]!+windowSeconds-nowSeconds);}
    recent.push(nowSeconds);events.set(key,recent);
    if(events.size>4096)for(const [k,v] of events)if(!v.some(t=>t>floor))events.delete(k);
    return null;
  }};
}
