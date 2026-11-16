/**
 * 營隊應變用（2026-11-16）：暫時從「添加擴展」清單隱藏的擴展。
 *
 * 開課期間某個擴展出問題、一時修不好時，把它的 extensionId 加進這裡、重新建置並部署，
 * 學員就加不到它；**已經用到它的作品照常開啟**（擴展本身仍註冊在 scratch-vm，只是不在清單上）。
 * 修好後從這裡拿掉，再建置部署一次。步驟見 `營隊平台/開課前應變手冊.md`。
 *
 * 可用的 id：camparduino、facemesh2scratch、handpose2scratch、posenet2scratch、ml2scratch、
 * campspeech、tm2scratch、tmpose2scratch（以及官方擴展的 id，例如 pen、music）。
 */
const CAMP_HIDDEN_EXTENSIONS = [];

export default CAMP_HIDDEN_EXTENSIONS;
