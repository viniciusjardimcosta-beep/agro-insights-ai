import fs from "fs";
import jsPDF from "jspdf";
(globalThis as any).MouseEvent = class { constructor(_t:string,_o?:any){} };
let blobs: any[] = [];
(globalThis as any).URL.createObjectURL = (b:any) => { blobs.push(b); return "blob:x"; };
(globalThis as any).URL.revokeObjectURL = () => {};
(globalThis as any).document = { createElement: () => ({ dispatchEvent: () => true, style:{} }) };

const { generateExecutiveReport } = await import("/dev-server/src/lib/report.ts");

function fields(n:number){ return Array.from({length:n},(_,i)=>({id:"f"+i,name:`Talhão ${i+1} Muito Comprido`,crop: i%2?"Soja":"Milho",area:50+i,expected_yield:60,property_id:"p"})); }
function costs(fs:any[]){ return fs.flatMap((f,i)=>[{field_id:f.id,category:"Insumos",amount:100000+i*1000,date:"2026-01-01"},{field_id:f.id,category:"Mão de obra",amount:20000,date:"2026-01-01"}]); }
const prices=[{crop:"Soja",price_per_bag:120,date:"2026-01-01"},{crop:"Milho",price_per_bag:60,date:"2026-01-01"}];
const diag={id:"d",created_at:new Date().toISOString(),health_score:62,report:{healthScore:62,scoreReason:"Margem baixa",scoreBreakdown:[{label:"Margem abaixo de 20%",points:-10},{label:"Diversificação",points:5}],risks:["Risco A"],opportunities:["Oport B"],actionPlan:["Ação 1 detalhada","Ação 2","Ação 3"],indicators:{mostProfitableCrop:"Soja",leastProfitableCrop:"Milho",mostEfficientField:"T1",leastEfficientField:"T2",singleCropDependencyPct:55},finance:{revenue:1,costs:1,profit:1,profitPerHa:1},metrics:{margin:12.345,depPct:55.55,negativeFieldsCount:1,topCrop:"Soja"}}};
const scen=[{id:"s1",name:"Otimista",simulated_score:70,metrics_snapshot:{revenue:200000,costs:150000,profit:50000,margin:25.5},created_at:"",user_id:"",overrides:{},score_breakdown:[]}] as any;

const cases: [string, any][] = [
 ["sem-diagnostico",{properties:[{name:"Fazenda X",city:"Sorriso",state:"MT"}],fields:fields(3),costs:costs(fields(3)),prices,latestDiagnostic:null,scenarios:scen,producerName:"João"}],
 ["sem-cenario",{properties:[{name:"Fazenda X"}],fields:fields(3),costs:costs(fields(3)),prices,latestDiagnostic:diag,scenarios:[],producerName:null}],
 ["1-talhao",{properties:[{name:"F"}],fields:fields(1),costs:costs(fields(1)),prices,latestDiagnostic:diag,scenarios:scen,producerName:"Ana"}],
 ["10-talhoes",{properties:[{name:"F"}],fields:fields(10),costs:costs(fields(10)),prices,latestDiagnostic:diag,scenarios:scen,producerName:"Ana"}],
 ["12-talhoes",{properties:[{name:"F"}],fields:fields(12),costs:costs(fields(12)),prices,latestDiagnostic:diag,scenarios:scen,producerName:"Ana"}],
 ["20-talhoes",{properties:[{name:"F"}],fields:fields(20),costs:costs(fields(20)),prices,latestDiagnostic:diag,scenarios:scen,producerName:"Ana"}],
 ["25-talhoes",{properties:[{name:"F"}],fields:fields(25),costs:costs(fields(25)),prices,latestDiagnostic:diag,scenarios:scen,producerName:""}],
 ["nada",{properties:[{name:"F"}],fields:fields(2),costs:costs(fields(2)),prices,latestDiagnostic:null,scenarios:[],producerName:""}],
];
for(const [name,input] of cases){ blobs=[]; generateExecutiveReport(input); fs.writeFileSync(`/tmp/rt/${name}.pdf`, Buffer.from(await blobs[0].arrayBuffer())); }
console.log("ok");
