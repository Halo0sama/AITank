"use strict";
class AIProgramSandbox {
  constructor(){this.frame=null;this.pending=null;this.sequence=0;this.session=crypto.randomUUID();this.source=null}
  async load(code){
    this.stop();this.source=code;
    const frame=document.createElement("iframe");frame.hidden=true;frame.sandbox="allow-scripts";frame.src="ai-sandbox.html?v=7";
    this.frame=frame;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("算法隔离环境启动失败")),1200);
      frame.onload=()=>{clearTimeout(timer);resolve()};document.body.append(frame);
    });
    this.listener=event=>{
      if(event.source!==frame.contentWindow||event.data?.session!==this.session||!this.pending||event.data.id!==this.pending.id)return;
      const pending=this.pending;this.pending=null;clearTimeout(pending.timer);
      if(event.data.type==="error")pending.reject(new Error(event.data.error));else pending.resolve(event.data.value);
    };
    addEventListener("message",this.listener);
    await this.request({type:"init",code,library:AITankWeapons.sandboxSource()},1000);
  }
  request(message,timeout=200){
    if(this.pending||!this.frame) return Promise.reject(new Error("算法运行器尚未就绪"));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,timer=setTimeout(()=>{this.pending=null;reject(new Error("算法运行超时"));this.stop()},timeout);
      this.pending={id,timer,resolve,reject};this.frame.contentWindow.postMessage({...message,id,session:this.session},"*");
    });
  }
  async tick(state){const value=await this.request({type:"tick",state});return AITankAI.intent(value,state.width,state.height)}
  stop(){
    if(this.pending){clearTimeout(this.pending.timer);this.pending.reject(new Error("算法已停止"));this.pending=null}
    if(this.listener)removeEventListener("message",this.listener);this.listener=null;
    this.frame?.remove();this.frame=null;this.source=null;
  }
}
