export async function configureSidePanel(chromeApi=chrome){
  if(!chromeApi?.sidePanel?.setPanelBehavior) return;
  await chromeApi.sidePanel.setPanelBehavior({openPanelOnActionClick:true});
}
