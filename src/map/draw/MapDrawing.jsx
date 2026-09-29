import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDispatch, useSelector } from 'react-redux';
import * as maplibregl from 'maplibre-gl';
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import EditIcon from '@mui/icons-material/Edit';
import TimelineIcon from '@mui/icons-material/Timeline';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PentagonOutlinedIcon from '@mui/icons-material/PentagonOutlined';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CircleOutlinedIcon from '@mui/icons-material/CircleOutlined';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import { map, useMapReady } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import { fromMapCoordinates, toMapCoordinates } from '../core/mapUtil';
import fetchOrThrow from '../../common/util/fetchOrThrow';
import { drawingsActions, errorsActions } from '../../store';
import { useTranslation } from '../../common/components/LocalizationProvider';
import {
  canDeleteDrawingInMode,
  canEditDrawings,
  createArrowheadSdfImage,
  DEFAULT_DRAWING_TEXT_SIZE,
  DRAWING_TEXT_SIZES,
  drawingToolbarExpandedKey,
  drawingVisibilityKey,
  drawingFeatureId,
  drawingToEditableFeature,
  drawingsToFeatureCollection,
  editableFeatureToDrawing,
  loadDrawingVisibility,
  loadDrawingToolbarExpanded,
  normalizeDrawingColor,
  normalizeDrawingText,
  normalizeDrawingTextSize,
  nextDrawingDeleteMode,
  staticDrawingFilter,
} from './drawingUtils';

const drawingModes = {
  line: 'linestring',
  arrow: 'linestring',
  polygon: 'polygon',
  rectangle: 'rectangle',
  circle: 'circle',
  text: 'point',
};

const DrawingButton = ({ title, active, disabled = false, onClick, children }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    style={{ backgroundColor: active ? '#e6e6e6' : undefined }}
  >
    {children}
  </button>
);

const MarkupIcon = () => (
  <span
    style={{
      width: 22,
      height: 22,
      border: '1.5px solid currentColor',
      borderRadius: '50%',
      display: 'grid',
      placeItems: 'center',
      boxSizing: 'border-box',
    }}
  >
    <DrawOutlinedIcon sx={{ fontSize: 16 }} />
  </span>
);

const DrawingControls = ({
  t,
  visible,
  expanded,
  editable,
  administrator,
  activeMode,
  selected,
  color,
  deleteMode,
  onVisible,
  onExpanded,
  onMode,
  onProperties,
  onColor,
  onDelete,
  onAdminDelete,
}) => (
  <>
    <DrawingButton title={visible ? t('mapDrawingHide') : t('mapDrawingShow')} onClick={onVisible}>
      {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
    </DrawingButton>
    <DrawingButton
      title={expanded ? t('mapDrawingCollapse') : t('mapDrawingExpand')}
      active={expanded}
      onClick={onExpanded}
    >
      <MarkupIcon />
    </DrawingButton>
    {expanded && visible && editable && (
      <>
        <DrawingButton
          title={t('mapDrawingEdit')}
          active={activeMode === 'select'}
          onClick={() => onMode('select')}
        >
          <EditIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingLine')}
          active={activeMode === 'line'}
          onClick={() => onMode('line')}
        >
          <TimelineIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingArrow')}
          active={activeMode === 'arrow'}
          onClick={() => onMode('arrow')}
        >
          <ArrowForwardIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingPolygon')}
          active={activeMode === 'polygon'}
          onClick={() => onMode('polygon')}
        >
          <PentagonOutlinedIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingRectangle')}
          active={activeMode === 'rectangle'}
          onClick={() => onMode('rectangle')}
        >
          <CropSquareIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingText')}
          active={activeMode === 'text'}
          onClick={() => onMode('text')}
        >
          <TextFieldsIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingCircle')}
          active={activeMode === 'circle'}
          onClick={() => onMode('circle')}
        >
          <CircleOutlinedIcon fontSize="small" />
        </DrawingButton>
        <label
          title={t('mapDrawingColor')}
          style={{
            position: 'relative',
            width: 29,
            height: 29,
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              backgroundColor: color,
              border: '2px solid white',
              boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.45)',
              boxSizing: 'border-box',
            }}
          />
          <input
            aria-label={t('mapDrawingColor')}
            type="color"
            value={color}
            onChange={(event) => onColor(event.target.value)}
            style={{ position: 'absolute', inset: 0, width: 29, height: 29, opacity: 0 }}
          />
        </label>
        <DrawingButton
          title={t('mapDrawingProperties')}
          disabled={!selected}
          onClick={onProperties}
        >
          <TuneOutlinedIcon fontSize="small" />
        </DrawingButton>
        <DrawingButton
          title={t('mapDrawingDelete')}
          active={deleteMode === 'own'}
          onClick={onDelete}
        >
          <DeleteOutlineIcon fontSize="small" />
        </DrawingButton>
      </>
    )}
    {expanded && visible && administrator && (
      <DrawingButton
        title={t('mapDrawingDeleteOther')}
        active={deleteMode === 'foreign'}
        onClick={onAdminDelete}
      >
        <AdminPanelSettingsOutlinedIcon fontSize="small" />
      </DrawingButton>
    )}
  </>
);

const DRAWING_ARROWHEAD_IMAGE = 'drawing-arrowhead-sdf';

const useDrawingArrowheadImage = (enabled) => {
  const mapReady = useMapReady();
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    if (!enabled || !mapReady) {
      setImageReady(false);
      return;
    }
    if (!map.hasImage(DRAWING_ARROWHEAD_IMAGE)) {
      map.addImage(DRAWING_ARROWHEAD_IMAGE, createArrowheadSdfImage(), { sdf: true });
    }
    setImageReady(true);
    return () => setImageReady(false);
  }, [enabled, mapReady]);

  return imageReady;
};

const MapDrawingLayer = ({ drawings, enabled, editingOwnerId, onDrawingClick }) => {
  const t = useTranslation();
  const popupRef = useRef();
  const arrowheadReady = useDrawingArrowheadImage(enabled);

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    [],
  );

  const showOwner = useCallback(
    (event) => {
      const feature = event.features[0];
      if (Number(feature.properties.ownerId) === editingOwnerId) return;
      popupRef.current?.remove();
      const content = document.createElement('div');
      content.textContent = `${t('mapDrawingOwner')}: ${feature.properties.ownerName}`;
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnMove: true })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
    },
    [editingOwnerId, t],
  );

  const onClick = useCallback(
    (event) => {
      if (Number(event.features[0].properties.ownerId) === editingOwnerId) return;
      event.preventDefault();
      if (onDrawingClick(event.features[0].properties.drawingId)) return;
      showOwner(event);
    },
    [editingOwnerId, onDrawingClick, showOwner],
  );

  const onMouseEnter = useCallback(
    (event) => {
      if (Number(event.features[0].properties.ownerId) === editingOwnerId) return;
      map.getCanvas().style.cursor = 'pointer';
      showOwner(event);
    },
    [editingOwnerId, showOwner],
  );
  const onMouseLeave = useCallback(() => {
    map.getCanvas().style.cursor = '';
    popupRef.current?.remove();
  }, []);
  const events = useMemo(
    () => ({ click: onClick, mouseenter: onMouseEnter, mouseleave: onMouseLeave }),
    [onClick, onMouseEnter, onMouseLeave],
  );

  useMapLayer({
    enabled: enabled && arrowheadReady,
    layers: [
      {
        key: 'fill',
        type: 'fill',
        filter: staticDrawingFilter(['polygon', 'rectangle', 'circle'], editingOwnerId),
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.18,
        },
        on: events,
      },
      {
        key: 'line',
        type: 'line',
        filter: staticDrawingFilter(
          ['line', 'arrow', 'polygon', 'rectangle', 'circle'],
          editingOwnerId,
        ),
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 3,
        },
        on: events,
      },
      {
        key: 'arrow',
        type: 'symbol',
        filter: ['==', ['get', 'drawingType'], 'arrowhead'],
        layout: {
          'icon-image': DRAWING_ARROWHEAD_IMAGE,
          'icon-size': 0.72,
          'icon-rotate': ['get', 'rotation'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          'icon-color': ['get', 'color'],
          'icon-halo-color': 'white',
          'icon-halo-width': 0.75,
        },
        on: events,
      },
    ],
    layersDeps: [events, editingOwnerId, arrowheadReady],
    data: drawingsToFeatureCollection(drawings, ([longitude, latitude]) =>
      toMapCoordinates(longitude, latitude),
    ),
    dataDeps: [drawings, editingOwnerId, events],
  });

  return null;
};

const MapDrawingTextMarkers = ({
  drawings,
  enabled,
  editingOwnerId,
  selectedDrawingId,
  onEditDrawing,
  onDrawingClick,
}) => {
  const t = useTranslation();

  useEffect(() => {
    if (!enabled) return undefined;
    const markers = drawings
      .filter((drawing) => drawing.type === 'text')
      .map((drawing) => {
        const element = document.createElement('div');
        element.textContent = drawing.text || '';
        element.style.color = normalizeDrawingColor(drawing.color);
        element.style.fontSize = `${normalizeDrawingTextSize(drawing.textSize)}px`;
        element.style.fontWeight = drawing.textBold ? '700' : '400';
        element.style.fontStyle = drawing.textItalic ? 'italic' : 'normal';
        element.style.fontFamily = 'sans-serif';
        element.style.lineHeight = '1.2';
        element.style.whiteSpace = 'pre-wrap';
        element.style.overflowWrap = 'anywhere';
        element.style.textShadow =
          '-1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white, 0 0 3px white';
        element.style.userSelect = 'none';
        element.style.cursor = 'pointer';
        element.style.pointerEvents = drawing.id === selectedDrawingId ? 'none' : 'auto';

        let popup;
        const showOwner = () => {
          popup?.remove();
          const content = document.createElement('div');
          content.textContent = `${t('mapDrawingOwner')}: ${drawing.ownerName || ''}`;
          const [longitude, latitude] = drawing.geometry.coordinates;
          popup = new maplibregl.Popup({ closeButton: false, closeOnMove: true })
            .setLngLat(toMapCoordinates(longitude, latitude))
            .setDOMContent(content)
            .addTo(map);
        };
        const handleClick = (event) => {
          event.stopPropagation();
          if (drawing.ownerId === editingOwnerId && onEditDrawing(drawing.id)) return;
          if (!onDrawingClick(drawing.id)) showOwner();
        };
        element.onmouseenter = showOwner;
        element.onmouseleave = () => popup?.remove();
        element.onclick = handleClick;

        const [longitude, latitude] = drawing.geometry.coordinates;
        const marker = new maplibregl.Marker({ element, anchor: 'top-left', offset: [5, 5] })
          .setLngLat(toMapCoordinates(longitude, latitude))
          .addTo(map);
        return {
          remove: () => {
            popup?.remove();
            element.onmouseenter = null;
            element.onmouseleave = null;
            element.onclick = null;
            marker.remove();
          },
        };
      });
    return () => markers.forEach((marker) => marker.remove());
  }, [drawings, editingOwnerId, enabled, onDrawingClick, onEditDrawing, selectedDrawingId, t]);

  return null;
};

const featureColor = (feature, fallback) =>
  normalizeDrawingColor(feature.properties.color, fallback.current);

const MapDrawing = ({ active, onActiveChange }) => {
  const theme = useTheme();
  const t = useTranslation();
  const dispatch = useDispatch();
  const user = useSelector((state) => state.session.user);
  const drawingItems = useSelector((state) => state.drawings.items);
  const drawings = useMemo(() => Object.values(drawingItems), [drawingItems]);
  const editable = canEditDrawings(user);
  const visibilityKey = drawingVisibilityKey(user.id);
  const expandedKey = drawingToolbarExpandedKey(user.id);

  const [visible, setVisible] = useState(() => loadDrawingVisibility(window.localStorage, user.id));
  const [expanded, setExpanded] = useState(() =>
    loadDrawingToolbarExpanded(window.localStorage, user.id),
  );
  const [requestedMode, setRequestedMode] = useState('select');
  const [activeMode, setActiveMode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [color, setColor] = useState('#FF0000');
  const [deleteMode, setDeleteMode] = useState(null);
  const [pendingProperties, setPendingProperties] = useState(null);
  const [propertiesColor, setPropertiesColor] = useState('#FF0000');
  const [textValue, setTextValue] = useState('');
  const [textSize, setTextSize] = useState(DEFAULT_DRAWING_TEXT_SIZE);
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);

  const drawRef = useRef();
  const onActiveChangeRef = useRef(onActiveChange);
  const drawingsRef = useRef(drawings);
  const requestedModeRef = useRef(requestedMode);
  const colorRef = useRef(color);
  const deletingIdsRef = useRef(new Set());
  const wasActiveRef = useRef(active);
  drawingsRef.current = drawings;
  requestedModeRef.current = requestedMode;
  colorRef.current = color;
  onActiveChangeRef.current = onActiveChange;

  useEffect(() => {
    setVisible(loadDrawingVisibility(window.localStorage, user.id));
    setExpanded(loadDrawingToolbarExpanded(window.localStorage, user.id));
    setDeleteMode(null);
    setPendingProperties(null);
    setRequestedMode('select');
    onActiveChangeRef.current(false);
  }, [user.id]);

  useEffect(() => {
    if (wasActiveRef.current && !active) setDeleteMode(null);
    wasActiveRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!editable) {
      setDeleteMode(null);
      setPendingProperties(null);
      setRequestedMode('select');
      onActiveChangeRef.current(false);
    }
  }, [editable]);

  const updateVisible = useCallback(
    (value) => {
      setVisible(value);
      window.localStorage.setItem(visibilityKey, JSON.stringify(value));
    },
    [visibilityKey],
  );

  const updateExpanded = useCallback(
    (value) => {
      setExpanded(value);
      window.localStorage.setItem(expandedKey, JSON.stringify(value));
      if (!value) {
        setDeleteMode(null);
        setRequestedMode('select');
        onActiveChange(false);
      }
    },
    [expandedKey, onActiveChange],
  );

  const refresh = useCallback(async () => {
    const response = await fetchOrThrow('/api/drawings');
    dispatch(drawingsActions.refresh(await response.json()));
  }, [dispatch]);

  const writeFeature = useCallback(
    async (feature, drawingType, drawingColor, drawingText) => {
      const existingId = Number(feature.properties.drawingId) || null;
      const payload = editableFeatureToDrawing(
        feature,
        drawingType,
        drawingColor,
        drawingText,
        ([longitude, latitude]) => fromMapCoordinates(longitude, latitude),
      );
      if (existingId) {
        const existing = drawingsRef.current.find((drawing) => drawing.id === existingId);
        if (existing) dispatch(drawingsActions.upsert({ ...existing, ...payload }));
      }
      try {
        const response = await fetchOrThrow(
          existingId ? `/api/drawings/${existingId}` : '/api/drawings',
          {
            method: existingId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        const saved = await response.json();
        dispatch(drawingsActions.upsert(saved));
        if (!existingId && drawRef.current?.hasFeature(feature.id)) {
          drawRef.current.removeFeatures([feature.id]);
        }
        return true;
      } catch (error) {
        dispatch(errorsActions.push(error.message));
        if (!existingId && drawRef.current?.hasFeature(feature.id)) {
          drawRef.current.removeFeatures([feature.id]);
        }
        await refresh();
        return false;
      }
    },
    [dispatch, refresh],
  );

  const syncEditor = useCallback(() => {
    const draw = drawRef.current;
    if (!draw?.enabled || draw.getModeState() === 'drawing') return;
    const existing = draw
      .getSnapshot()
      .filter((feature) => feature.properties.drawingId)
      .map((feature) => feature.id);
    if (existing.length) draw.removeFeatures(existing);
    const ownFeatures = drawingsRef.current
      .filter((drawing) => drawing.ownerId === user.id)
      .map((drawing) =>
        drawingToEditableFeature(drawing, ([longitude, latitude]) =>
          toMapCoordinates(longitude, latitude),
        ),
      );
    if (ownFeatures.length) draw.addFeatures(ownFeatures);
  }, [user.id]);

  useEffect(() => {
    syncEditor();
  }, [drawings, syncEditor]);

  useEffect(() => {
    if (!active || !visible || !editable || deleteMode) return undefined;
    const styleColor = (feature) => featureColor(feature, colorRef);
    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map, prefixId: 'map-drawing-editor' }),
      modes: [
        new TerraDrawSelectMode({
          flags: {
            linestring: {
              feature: {
                draggable: true,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
            polygon: {
              feature: {
                draggable: true,
                coordinates: { draggable: true, midpoints: true, deletable: true },
              },
            },
            rectangle: { feature: { draggable: true, scaleable: true } },
            circle: { feature: { draggable: true, scaleable: true } },
            point: { feature: { draggable: true } },
          },
          keyEvents: { deselect: 'Escape', delete: null, rotate: null, scale: null },
        }),
        new TerraDrawLineStringMode({
          styles: { lineStringColor: styleColor, lineStringWidth: 3 },
        }),
        new TerraDrawPolygonMode({
          styles: { fillColor: styleColor, outlineColor: styleColor, fillOpacity: 0.18 },
        }),
        new TerraDrawRectangleMode({
          drawInteraction: 'click-move-or-drag',
          styles: { fillColor: styleColor, outlineColor: styleColor, fillOpacity: 0.18 },
        }),
        new TerraDrawCircleMode({
          drawInteraction: 'click-move-or-drag',
          styles: { fillColor: styleColor, outlineColor: styleColor, fillOpacity: 0.18 },
        }),
        new TerraDrawPointMode({
          styles: {
            pointColor: styleColor,
            pointWidth: (feature) => (feature.properties.drawingType === 'text' ? 1 : 8),
            pointOpacity: (feature) => (feature.properties.drawingType === 'text' ? 0 : 1),
            pointOutlineOpacity: (feature) => (feature.properties.drawingType === 'text' ? 0 : 1),
          },
        }),
      ],
    });
    drawRef.current = draw;
    draw.on('select', (id) => {
      setSelectedId(id);
      const feature = draw.getSnapshotFeature(id);
      if (feature?.properties.color) setColor(normalizeDrawingColor(feature.properties.color));
    });
    draw.on('deselect', () => setSelectedId(null));
    draw.on('finish', (id) => {
      const feature = draw.getSnapshotFeature(id);
      if (!feature) return;
      const drawingType = feature.properties.drawingType || requestedModeRef.current;
      const drawingColor = feature.properties.color || colorRef.current;
      draw.updateFeatureProperties(id, {
        drawingType,
        color: normalizeDrawingColor(drawingColor),
      });
      const updatedFeature = draw.getSnapshotFeature(id);
      if (drawingType === 'text' && !updatedFeature.properties.drawingId) {
        draw.updateFeatureProperties(id, {
          text: '',
          textSize: DEFAULT_DRAWING_TEXT_SIZE,
          textBold: false,
          textItalic: false,
        });
        setPendingProperties({ featureId: id, isNew: true, drawingType: 'text' });
        setPropertiesColor(normalizeDrawingColor(drawingColor));
        setTextValue('');
        setTextSize(DEFAULT_DRAWING_TEXT_SIZE);
        setTextBold(false);
        setTextItalic(false);
      } else {
        writeFeature(updatedFeature, drawingType, drawingColor);
        setRequestedMode('select');
        setActiveMode('select');
        draw.setMode('select');
      }
    });
    draw.start();
    syncEditor();
    draw.setMode(drawingModes[requestedModeRef.current] || 'select');
    setActiveMode(requestedModeRef.current);
    return () => {
      draw.stop();
      if (drawRef.current === draw) drawRef.current = null;
      setSelectedId(null);
      setActiveMode(null);
    };
  }, [active, deleteMode, editable, syncEditor, visible, writeFeature]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw?.enabled) return;
    const terraMode = drawingModes[requestedMode] || 'select';
    if (draw.getMode() !== terraMode) draw.setMode(terraMode);
    setActiveMode(requestedMode);
  }, [requestedMode]);

  const selectMode = useCallback(
    (mode) => {
      setDeleteMode(null);
      setRequestedMode(mode);
      onActiveChange(true);
    },
    [onActiveChange],
  );

  const openSelectedProperties = useCallback(() => {
    const feature = selectedId && drawRef.current?.getSnapshotFeature(selectedId);
    if (!feature?.properties.drawingId) return;
    const drawingType = feature.properties.drawingType;
    setPendingProperties({ featureId: selectedId, isNew: false, drawingType });
    setPropertiesColor(normalizeDrawingColor(feature.properties.color));
    setTextValue(feature.properties.text || '');
    setTextSize(normalizeDrawingTextSize(feature.properties.textSize));
    setTextBold(Boolean(feature.properties.textBold));
    setTextItalic(Boolean(feature.properties.textItalic));
  }, [selectedId]);

  const changeColor = useCallback(
    async (value) => {
      const normalized = normalizeDrawingColor(value);
      setColor(normalized);
      const draw = drawRef.current;
      if (selectedId && draw?.hasFeature(selectedId)) {
        draw.updateFeatureProperties(selectedId, { color: normalized });
        const feature = draw.getSnapshotFeature(selectedId);
        await writeFeature(feature, feature.properties.drawingType, normalized);
      }
    },
    [selectedId, writeFeature],
  );

  const handleDrawingClick = useCallback(
    (drawingId) => {
      const drawing = drawingItems[Number(drawingId)];
      if (!canDeleteDrawingInMode(deleteMode, drawing, user)) return false;
      if (deletingIdsRef.current.has(drawing.id)) return true;
      const confirmation =
        deleteMode === 'foreign' ? t('mapDrawingDeleteOtherConfirm') : t('mapDrawingDeleteConfirm');
      if (!window.confirm(confirmation)) return true;
      deletingIdsRef.current.add(drawing.id);
      void (async () => {
        try {
          await fetchOrThrow(`/api/drawings/${drawing.id}`, { method: 'DELETE' });
          dispatch(drawingsActions.remove(drawing.id));
        } catch (error) {
          dispatch(errorsActions.push(error.message));
          await refresh();
        } finally {
          deletingIdsRef.current.delete(drawing.id);
        }
      })();
      return true;
    },
    [deleteMode, dispatch, drawingItems, refresh, t, user],
  );

  const selectTextDrawing = useCallback((drawingId) => {
    const draw = drawRef.current;
    const featureId = drawingFeatureId(drawingId);
    if (!draw?.enabled || !draw.hasFeature(featureId)) return false;
    setDeleteMode(null);
    setRequestedMode('select');
    if (draw.getMode() !== 'select') draw.setMode('select');
    draw.selectFeature(featureId);
    return true;
  }, []);

  const saveProperties = useCallback(async () => {
    const draw = drawRef.current;
    const feature = pendingProperties && draw?.getSnapshotFeature(pendingProperties.featureId);
    const drawingType = pendingProperties?.drawingType;
    const normalizedText = drawingType === 'text' ? normalizeDrawingText(textValue).trim() : null;
    if (!feature || (drawingType === 'text' && !normalizedText)) return;
    const normalizedColor = normalizeDrawingColor(propertiesColor);
    const properties = { drawingType, color: normalizedColor };
    if (drawingType === 'text') {
      Object.assign(properties, {
        text: normalizedText,
        textSize,
        textBold,
        textItalic,
      });
    }
    draw.updateFeatureProperties(feature.id, properties);
    setColor(normalizedColor);
    await writeFeature(
      draw.getSnapshotFeature(feature.id),
      drawingType,
      normalizedColor,
      normalizedText,
    );
    setPendingProperties(null);
    setRequestedMode('select');
  }, [pendingProperties, propertiesColor, textBold, textItalic, textSize, textValue, writeFeature]);

  const cancelProperties = useCallback(() => {
    const draw = drawRef.current;
    if (pendingProperties?.isNew && draw?.hasFeature(pendingProperties.featureId)) {
      draw.removeFeatures([pendingProperties.featureId]);
    }
    setPendingProperties(null);
    setRequestedMode('select');
  }, [pendingProperties]);

  const toggleDeleteMode = useCallback(
    (requestedDeleteMode) => {
      cancelProperties();
      const nextMode = nextDrawingDeleteMode(deleteMode, requestedDeleteMode);
      setDeleteMode(nextMode);
      setRequestedMode('select');
      onActiveChange(Boolean(nextMode));
    },
    [cancelProperties, deleteMode, onActiveChange],
  );

  const controlsRootRef = useRef();
  useEffect(() => {
    let container;
    const control = {
      onAdd: () => {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        container.style.display = 'grid';
        container.style.gridTemplateColumns = 'repeat(2, 29px)';
        container.style.width = '58px';
        controlsRootRef.current = createRoot(container);
        return container;
      },
      onRemove: () => {
        queueMicrotask(() => controlsRootRef.current?.unmount());
        controlsRootRef.current = null;
        container.remove();
      },
    };
    map.addControl(control, theme.direction === 'rtl' ? 'top-left' : 'top-right');
    return () => map.removeControl(control);
  }, [theme.direction]);

  useEffect(() => {
    controlsRootRef.current?.render(
      <DrawingControls
        t={t}
        visible={visible}
        expanded={expanded}
        editable={editable}
        administrator={user.administrator}
        activeMode={activeMode}
        selected={Boolean(selectedId)}
        color={color}
        deleteMode={deleteMode}
        onVisible={() => {
          if (visible) cancelProperties();
          updateVisible(!visible);
          setDeleteMode(null);
          if (visible) onActiveChange(false);
        }}
        onExpanded={() => {
          if (expanded) cancelProperties();
          updateExpanded(!expanded);
        }}
        onMode={selectMode}
        onProperties={openSelectedProperties}
        onColor={changeColor}
        onDelete={() => toggleDeleteMode('own')}
        onAdminDelete={() => toggleDeleteMode('foreign')}
      />,
    );
  }, [
    activeMode,
    cancelProperties,
    changeColor,
    color,
    deleteMode,
    editable,
    expanded,
    openSelectedProperties,
    onActiveChange,
    selectMode,
    selectedId,
    updateVisible,
    updateExpanded,
    t,
    user.administrator,
    visible,
    toggleDeleteMode,
  ]);

  const editingOwnerId = active && editable && !deleteMode ? user.id : null;
  const selectedDrawingId = Number(
    selectedId && drawRef.current?.getSnapshotFeature(selectedId)?.properties.drawingId,
  );

  return (
    <>
      <MapDrawingLayer
        drawings={drawings}
        enabled={visible}
        editingOwnerId={editingOwnerId}
        onDrawingClick={handleDrawingClick}
      />
      <MapDrawingTextMarkers
        drawings={drawings}
        enabled={visible}
        editingOwnerId={editingOwnerId}
        selectedDrawingId={selectedDrawingId || null}
        onEditDrawing={selectTextDrawing}
        onDrawingClick={handleDrawingClick}
      />
      <Dialog open={Boolean(pendingProperties)} onClose={cancelProperties} fullWidth maxWidth="sm">
        <DialogTitle>
          {pendingProperties?.isNew ? t('mapDrawingText') : t('mapDrawingProperties')}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            margin="dense"
            type="color"
            label={t('mapDrawingColor')}
            value={propertiesColor}
            onChange={(event) => setPropertiesColor(normalizeDrawingColor(event.target.value))}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {pendingProperties?.drawingType === 'text' && (
            <>
              <TextField
                autoFocus
                fullWidth
                multiline
                minRows={3}
                margin="dense"
                value={textValue}
                slotProps={{ htmlInput: { maxLength: 200 } }}
                onChange={(event) => setTextValue(normalizeDrawingText(event.target.value))}
                helperText={`${textValue.length}/200`}
              />
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  marginTop: 12,
                }}
              >
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={textSize}
                  aria-label={t('mapDrawingTextSize')}
                  onChange={(_, value) => value && setTextSize(value)}
                >
                  {DRAWING_TEXT_SIZES.map((size, index) => {
                    const keys = [
                      'mapDrawingTextSmall',
                      'mapDrawingTextMedium',
                      'mapDrawingTextLarge',
                      'mapDrawingTextExtraLarge',
                    ];
                    const labels = ['S', 'M', 'L', 'XL'];
                    return (
                      <ToggleButton
                        key={size}
                        value={size}
                        title={t(keys[index])}
                        aria-label={t(keys[index])}
                      >
                        {labels[index]}
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
                <ToggleButton
                  size="small"
                  selected={textBold}
                  value="bold"
                  title={t('mapDrawingTextBold')}
                  aria-label={t('mapDrawingTextBold')}
                  onChange={() => setTextBold((value) => !value)}
                >
                  <FormatBoldIcon fontSize="small" />
                </ToggleButton>
                <ToggleButton
                  size="small"
                  selected={textItalic}
                  value="italic"
                  title={t('mapDrawingTextItalic')}
                  aria-label={t('mapDrawingTextItalic')}
                  onChange={() => setTextItalic((value) => !value)}
                >
                  <FormatItalicIcon fontSize="small" />
                </ToggleButton>
              </div>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelProperties}>{t('sharedCancel')}</Button>
          <Button
            onClick={saveProperties}
            disabled={pendingProperties?.drawingType === 'text' && !textValue.trim()}
          >
            {t('sharedSave')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MapDrawing;
