/**
 * 设备属性的说明文字：每一项是做什么的，用运维看得懂的话写。
 * 平台字典里的标题有的很生硬（例如"无人时是否持续上报监测结果数据"），这里可以给一个更顺口的名字。
 * 按属性名查，三种雷达（AIO 6、Ultra 13/15、slim 12）共用一张表；同名属性在不同设备上含义相同。
 */

export interface PropertyText {
  /** 显示的名字，不填就用平台字典的标题 */
  name?: string;
  /** 一句话说明它做什么 */
  desc?: string;
}

export const PROPERTY_TEXT: Record<string, PropertyText> = {
  // 基础
  device_onoff: { name: "雷达工作", desc: "关掉后雷达停止监测，也不再上报数据" },
  led_enable: { name: "指示灯", desc: "设备正面的指示灯，夜里怕打扰可以关掉" },
  talk_spk_vol: { name: "扬声器音量", desc: "通话和语音提示的音量" },
  talk_mic_vol: { name: "麦克风音量", desc: "通话时对方听到的音量" },
  working_times: { name: "工作时段", desc: "只在这些时段监测和告警" },
  onoff: { name: "工作时段", desc: "只在这些时段监测和告警" },
  radar_databuff_num: { name: "数据缓存条数", desc: "设备本地最多缓存多少条雷达数据" },
  tz_offset: { name: "时区", desc: "设备记录时间用的时区，夏令时不会自动切换" },
  heart: { name: "心跳间隔", desc: "设备多久向平台报一次在线" },
  QL_radar_para_ver: { name: "雷达模组版本" },
  QL_radar_info: { name: "雷达固件信息" },
  version: { name: "设备软件版本" },
  radar_ver: { name: "雷达固件版本" },
  cpuid: { name: "主控芯片编号", desc: "报修时可能需要提供" },
  time: { name: "设备时间" },
  snoring_record_url: { name: "鼾声上传地址", desc: "鼾声录音上传到哪台服务器" },
  "tts-phone": { name: "语音留言电话", desc: "平台给家属发语音留言时用的号码，只存在平台" },

  // 通话
  talk_type_sel: { name: "呼叫方式", desc: "局域网：呼叫同一网络里的管理主机；云对讲：通过 SIP 拨打电话" },
  talk_master_number: { name: "紧急号码", desc: "按下呼救或喊出唤醒词时，第一个拨打的号码" },
  talk_call_number_bak: { name: "拨打备用号码", desc: "紧急号码没人接时，依次拨打下面的备用号码" },
  talk_key1_number: { name: "备用号码 1" },
  talk_key2_number: { name: "备用号码 2" },
  talk_key3_number: { name: "备用号码 3" },
  talk_local_maxtime: { name: "单次通话最长", desc: "到时间自动挂断" },
  talk_call_timeout: { name: "呼叫等待", desc: "拨出后多久没人接就放弃" },
  call_record_EN: { name: "通话录音", desc: "开启后通话会录音并上传" },
  sip_account: { name: "SIP 号码", desc: "云对讲用的账号，由平台自动分配" },
  sip_password: { name: "SIP 密码" },
  sip_server: { name: "SIP 服务器" },

  // 音频
  ringback: { name: "呼叫等待音", desc: "拨号等待接通时播放，在平台网页端上传" },
  autoanswer: { name: "自动接听提示音", desc: "自动接听时播放，在平台网页端上传" },
  noise: { name: "舒适音", desc: "定时播放的舒缓音频，在平台网页端上传" },
  noise_spk_vol: { name: "舒适音音量" },
  noise_on_time_span: { name: "舒适音播放时段", desc: "在这些时段播放舒适音" },
  noise_volume_time_span: { name: "噪音检测时段", desc: "在这些时段检测环境噪音" },
  mic_record_time_span: { name: "录音时段", desc: "在这些时段打开麦克风录音" },

  // 语音识别
  offlsr_enable: { name: "语音呼救", desc: "开启后，老人喊出唤醒词（例如\"救命\"）就会触发呼救" },
  offlsr_keywords: { name: "唤醒词", desc: "哪些词能触发呼救，以及识别有多灵敏" },
  offlsr_response_file: { name: "回应提示音", desc: "听到唤醒词后播放的提示音" },
  offlsr_response_audio: { name: "自定义提示音", desc: "在平台网页端上传" },
  offlsr_response_volume: { name: "回应提示音音量" },
  offlsr_cooldown: { name: "两次唤醒的最短间隔", desc: "避免一句话被重复识别、连续触发" },

  // 外设
  slave_config: { name: "蓝牙外设", desc: "绑定到这台雷达的蓝牙设备，例如拉绳报警按钮" },
  slave_id: { name: "蓝牙外设编号", desc: "绑定的蓝牙外设的 SN" },
  slave_id_forwarding: { name: "外设事件转发", desc: "外设上报的事件转发到哪里，只存在平台" },
  heiman_slave_ids: { name: "环境传感器", desc: "关联到这台雷达的烟感、水浸等传感器，只存在平台" },
  ble_name: { name: "蓝牙名称" },
  ble_mac: { name: "蓝牙地址" },
  ble_ver: { name: "蓝牙版本" },

  // 告警参数（AIO）
  QL_radar_para_TH: { name: "呼吸心率告警", desc: "呼吸、心率超出正常范围，或生命体征持续偏弱时告警" },
  QL_radar_para_sit: { name: "坐地检测", desc: "检测有人坐在地上，坐久了告警" },
  QL_radar_para_fall: { name: "跌倒判定", desc: "倒地持续多久判定为跌倒" },

  // 告警参数（Ultra）
  QL_health_config: { name: "呼吸心率告警", desc: "呼吸、心率超出正常范围，或生命体征持续偏弱时告警" },
  QL_falldown_config: { name: "跌倒与坐地", desc: "跌倒、坐地、床上坐起的判定" },
  QL_reporting_mode: { name: "上报哪些数据", desc: "都不选时雷达不上报数据" },
  QL_radar_install: { name: "持续上报安装角度", desc: "关闭时，只在角度明显变化时上报" },
  QL_auto_boundary: { name: "自动测量房间边界", desc: "设为 1 开始测量，一分钟后自动结束" },

  // 安装
  QL_radar_config: { name: "安装与监测范围", desc: "雷达怎么装、装多高、监测多大范围" },
  QL_radar_area: { name: "区域划分", desc: "床、门等区域的位置，用来判断离床、进出门" },

  // slim
  rs_range_min: { name: "最近监测距离", desc: "离雷达比这更近的不监测" },
  rs_range_max: { name: "最远监测距离", desc: "离雷达比这更远的不监测" },
  rs_area: { name: "监测范围", desc: "左右多宽、离雷达多远的范围内监测" },
  rs_vital_th: { name: "体征异常灵敏度", desc: "越灵敏越早告警，也越容易误报" },
  rs_respiratory_th: { name: "呼吸异常灵敏度", desc: "越灵敏越早告警，也越容易误报" },
  rs_sleep_en: { name: "睡眠报告", desc: "开启后每天生成一份睡眠报告" },
  rs_sleep_slot: { name: "睡眠统计时段", desc: "统计这段时间里的睡眠" },
  rs_sleep_time: { name: "报告生成时间", desc: "每天几点生成睡眠报告" },
  rs_report_nobody: { name: "没人时也上报", desc: "关掉后，房间没人时不上报监测结果" },
  rs_report_freq: { name: "上报频率", desc: "监测结果多久上报一次" },

  // 网络（只读）
  net_dhcp: { name: "DHCP" },
  net_ip: { name: "IP 地址" },
  ip: { name: "IP 地址" },
  net_mask: { name: "子网掩码" },
  netmask: { name: "子网掩码" },
  net_gateway: { name: "网关" },
  gateway: { name: "网关" },
  net_dns: { name: "DNS" },
  dns: { name: "DNS" },
  wifi_dhcp: { name: "DHCP" },
  net_rssi: { name: "信号强度" },
  iccid: { name: "SIM 卡号" },
  ccid: { name: "SIM 卡号" },
  imei: { name: "4G 模块编号" },
  wifi_ssid: { name: "WiFi 名称" },
  wifi_pwd: { name: "WiFi 密码" },
  mqtt_broke_address: { name: "服务器地址" },
  mqtt_broke_port: { name: "服务器端口" },
  mqtt_user_name: { name: "登录用户名" },
  mqtt_user_password: { name: "登录密码" },
  mqtt_keepalive: { name: "保活间隔" },
};

/** 分组说明，按分组名查（不同设备的分组编号不一样，名字基本一致） */
export const GROUP_TEXT: Record<string, string> = {
  基础配置: "开关、工作时段、音量这些日常设置",
  基础设置: "开关、工作时段和设备信息",
  通话配置: "紧急呼叫打给谁、怎么打",
  音频配置: "提示音、舒适音和录音时段",
  语音识别: "老人喊出唤醒词就能呼救",
  雷达外设: "绑定的蓝牙按钮和传感器",
  蓝牙外设: "绑定的蓝牙按钮和传感器",
  参数设置: "什么情况下告警：呼吸心率、跌倒、坐地",
  雷达属性: "什么情况下告警，以及上报哪些数据",
  安装设置: "安装方式、监测范围和区域划分。在这里下发后会同步写回房间布置；改顶装 / 侧装时区域在房间里的位置不变，雷达挪到房间正中或最近的墙上。雷达可以在区域画布上拖到实际安装的位置（侧装沿墙挪），区域和监测范围跟着雷达一起挪。",
  安装区域: "安装方式、监测范围和区域划分。在这里下发后会同步写回房间布置；改顶装 / 侧装时区域在房间里的位置不变，雷达挪到房间正中或最近的墙上。",
  网络配置: "设备当前的网络信息，只能查看",
  网络设置: "设备当前的网络信息，只能查看",
  MQTT: "设备连接的消息服务器，只能查看",
};
