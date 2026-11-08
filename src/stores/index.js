import { defineStore } from 'pinia'

export const datashare = defineStore('datashare', {
  state: () => ({
    isLoading: true,
    fleetPersonnel: [],
    fleetDrones: [],
    fleetTasks: [],
    fleetViolations: [],
    fleetAlerts: [],
    fleetUpdatedAt: null,
    activePatrols: {},
    detections: [],
    lastViolationAlert: null,
    violationAlertTick: 0,
    weatherCity: null,
    weatherPatrol: null,
    routePlan: null,
    viewshed: {
      mode: 'idle',
      buildingsEnabled: true,
      terrainEnabled: true,
      meshPrecision: 'high',
      blindZoneVisible: true,
      gimbalPitch: -28,
      gimbalHeading: 0,
      scanProgress: 0,
      buildProgress: 0,
      scanning: false,
      analysing: false,
      canExport: false,
      visibleAreaM2: 0,
      blindAreaM2: 0,
      cumulativeVisibleM2: 0,
      cumulativeBlindM2: 0,
      currentWaypointIndex: null,
      areaSource: null,
      areaValidation: null,
      footprintAreaM2: 0,
      bboxFilterStats: null,
      boundsDebugVisible: false,
      savedWaypointCount: 0,
      error: null,
    },
    viewshedRecords: [],
    viewshedActions: null,
    mapUi: {
      layers: {
        wind: true,
        rain: true,
        heatmap: true,
        route: true,
        building: true,
        terrain: true,
        blindZone: true,
        cloud: true,
        orbit: false,
      },
      route: {
        lineIndex: 0,
        lines: [],
        intervalM: 50,
        patrolHeight: 600,
        editMode: false,
        generating: false,
        stats: { total: 0, risk: 0, normal: 0 },
      },
      survey: {
        activeTool: '',
        distanceTotalM: 0,
        areaPlaneM2: 0,
        areaSurfaceM2: 0,
        elevationCount: 0,
      },
      nofly: { drawing: false },
      orbit: {
        heightM: 50000,
        pitchDeg: -30,
      },
      simulation: {
        active: false,
        placedCount: 0,
      },
    },
    panelStates: {
      left: { stats: true, devices: true, personnel: true },
      right: { weather: true, route: true, viewshed: true, ai: true },
    },
    mapActions: null,
  }),
  actions: {
    setFleet(payload) {
      if (!payload) return
      this.fleetPersonnel = payload.personnel || []
      this.fleetDrones = payload.drones || []
      this.fleetTasks = payload.tasks || []
      this.fleetViolations = payload.violations || []
      this.fleetAlerts = payload.alerts || []
      this.activePatrols = payload.activePatrols || {}
      this.routePlan = payload.routePlan ?? this.routePlan
      if (payload.viewshedRecords) {
        this.viewshedRecords = payload.viewshedRecords
      }
      this.fleetUpdatedAt = payload.timestamp || new Date().toISOString()
    },
    setDetections(data) {
      this.detections = data?.detections || []
    },
    setViolationAlert(payload) {
      if (!payload) return
      this.lastViolationAlert = payload
      if (payload.violation) {
        const exists = this.fleetViolations.some(v => v.id === payload.violation.id)
        if (!exists) {
          this.fleetViolations.unshift(payload.violation)
        }
      }
      if (payload.task) {
        const taskExists = this.fleetTasks.some(t => t.id === payload.task.id)
        if (!taskExists) {
          this.fleetTasks.unshift(payload.task)
        }
      }
    },
    triggerViolationAlert(payload) {
      const id = payload?.violation?.id
      if (id && id === this.lastViolationAlert?.violation?.id && this.violationAlertTick) {
        this.setViolationAlert(payload)
        return
      }
      this.setViolationAlert(payload)
      this.violationAlertTick = Date.now()
    },
    addAlert(alert) {
      if (!alert) return
      this.fleetAlerts.unshift(alert)
    },
    setWeatherCity(data) {
      this.weatherCity = data
    },
    setWeatherPatrol(data) {
      this.weatherPatrol = data
    },
    setRoutePlan(data) {
      this.routePlan = data
    },
    clearWeatherPatrol() {
      this.weatherPatrol = null
    },
    patchViewshed(patch) {
      this.viewshed = { ...this.viewshed, ...patch }
    },
    addViewshedRecord(record) {
      if (!record) return
      this.viewshedRecords = [
        record,
        ...this.viewshedRecords.filter((r) => r.waypointId !== record.waypointId),
      ].slice(0, 200)
    },
    setViewshedRecords(records) {
      this.viewshedRecords = records || []
    },
    registerViewshedActions(actions) {
      this.viewshedActions = actions
    },
    unregisterViewshedActions() {
      this.viewshedActions = null
    },
    patchMapUi(patch) {
      this.mapUi = {
        ...this.mapUi,
        ...patch,
        layers: patch.layers ? { ...this.mapUi.layers, ...patch.layers } : this.mapUi.layers,
        route: patch.route ? { ...this.mapUi.route, ...patch.route } : this.mapUi.route,
        survey: patch.survey ? { ...this.mapUi.survey, ...patch.survey } : this.mapUi.survey,
        nofly: patch.nofly ? { ...this.mapUi.nofly, ...patch.nofly } : this.mapUi.nofly,
        orbit: patch.orbit ? { ...this.mapUi.orbit, ...patch.orbit } : this.mapUi.orbit,
        simulation: patch.simulation ? { ...this.mapUi.simulation, ...patch.simulation } : this.mapUi.simulation,
      }
    },
    patchPanelStates(patch) {
      this.panelStates = {
        ...this.panelStates,
        ...patch,
        left: patch.left ? { ...this.panelStates.left, ...patch.left } : this.panelStates.left,
        right: patch.right ? { ...this.panelStates.right, ...patch.right } : this.panelStates.right,
      }
    },
    registerMapActions(actions) {
      this.mapActions = actions
    },
    unregisterMapActions() {
      this.mapActions = null
    },
  },
})

export default datashare
