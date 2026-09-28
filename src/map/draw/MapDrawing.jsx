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
import { map } from '../core/MapView';
import useMapLayer from '../core/useMapLayer';
import { findFonts, fromMapCoordinates, toMapCoordinates } from '../core/mapUtil';
import fetchOrThrow from '../../common/util/fetchOrThrow';
import { drawingsActions, errorsActions } from '../../store';
import { useTranslation } from '../../common/components/LocalizationProvider';
import {
  canEditDrawings,
  drawingVisibilityKey,
  drawingToEditableFeature,
  drawingsToFeatureCollection,
  editableFeatureToDrawing,
  loadDrawingVisibility,
  normalizeDrawingColor,
  normalizeDrawingText,
} from './drawingUtils';

const drawingModes = {
  line: 'linestring',
  arrow: 'linestring',
  polygon: 'polygon',
  rectangle: 'rectangle',
  circle: 'circle',
  text: 'point',
};

const DrawingButton = ({ title, active, onClick, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    style={{ backgroundColor: active ? '#e6e6e6' : undefined }}
  >
    {children}
  </button>
);

const DrawingControls = ({
  t,
  visible,
  editable,
  administrator,
  activeMode,
  selected,
  color,
  adminDelete,
  onVisible,
  onMode,
  onColor,
  onDelete,
  onAdminDelete,
}) => (
  <>
    <DrawingButton title={visible ? t('mapDrawingHide') : t('mapDrawingShow')} onClick={onVisible}>
      {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
    </DrawingButton>
    {visible && editable && (
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
          title={selected ? t('mapDrawingEditText') : t('mapDrawingText')}
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
        <label title={t('mapDrawingColor')} style={{ width: 29, height: 29, display: 'block' }}>
          <input
            aria-label={t('mapDrawingColor')}
            type="color"
            value={color}
            onChange={(event) => onColor(event.target.value)}
            style={{ width: 29, height: 29, padding: 4, border: 0, background: 'transparent' }}
          />
        </label>
        <DrawingButton title={t('mapDrawingDelete')} onClick={onDelete}>
          <DeleteOutlineIcon fontSize="small" />
        </DrawingButton>
      </>
    )}
    {visible && administrator && (
      <DrawingButton
        title={t('mapDrawingDeleteOther')}
        active={adminDelete}
        onClick={onAdminDelete}
      >
        <AdminPanelSettingsOutlinedIcon fontSize="small" />
      </DrawingButton>
    )}
  </>
);

const MapDrawingLayer = ({ drawings, enabled, onDrawingClick }) => {
  const t = useTranslation();
  const popupRef = useRef();

  useEffect(
    () => () => {
      popupRef.current?.remove();
    },
    [],
  );

  const showOwner = useCallback(
    (event) => {
      const feature = event.features[0];
      popupRef.current?.remove();
      const content = document.createElement('div');
      content.textContent = `${t('mapDrawingOwner')}: ${feature.properties.ownerName}`;
      popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnMove: true })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
    },
    [t],
  );

  const onClick = useCallback(
    (event) => {
      event.preventDefault();
      if (onDrawingClick(event.features[0].properties.drawingId)) return;
      showOwner(event);
    },
    [onDrawingClick, showOwner],
  );

  const onMouseEnter = useCallback(
    (event) => {
      map.getCanvas().style.cursor = 'pointer';
      showOwner(event);
    },
    [showOwner],
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
    enabled,
    layers: [
      {
        key: 'fill',
        type: 'fill',
        filter: ['in', ['get', 'drawingType'], ['literal', ['polygon', 'rectangle', 'circle']]],
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.18,
        },
        on: events,
      },
      {
        key: 'line',
        type: 'line',
        filter: [
          'in',
          ['get', 'drawingType'],
          ['literal', ['line', 'arrow', 'polygon', 'rectangle', 'circle']],
        ],
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
          'text-field': '➤',
          'text-size': 22,
          'text-rotate': ['get', 'rotation'],
          'text-rotation-alignment': 'map',
          'text-allow-overlap': true,
          'text-font': findFonts(map),
        },
        paint: { 'text-color': ['get', 'color'] },
        on: events,
      },
      {
        key: 'text',
        type: 'symbol',
        filter: ['==', ['get', 'drawingType'], 'text'],
        layout: {
          'text-field': ['get', 'text'],
          'text-size': 14,
          'text-font': findFonts(map),
          'text-allow-overlap': true,
          'text-anchor': 'top-left',
          'text-offset': [0.4, 0.4],
        },
        paint: {
          'text-color': ['get', 'color'],
          'text-halo-color': 'white',
          'text-halo-width': 1.5,
        },
        on: events,
      },
    ],
    layersDeps: [events],
    data: drawingsToFeatureCollection(drawings, ([longitude, latitude]) =>
      toMapCoordinates(longitude, latitude),
    ),
    dataDeps: [drawings],
  });

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

  const [visible, setVisible] = useState(() => loadDrawingVisibility(window.localStorage, user.id));
  const [requestedMode, setRequestedMode] = useState('select');
  const [activeMode, setActiveMode] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [color, setColor] = useState('#FF0000');
  const [adminDelete, setAdminDelete] = useState(false);
  const [pendingText, setPendingText] = useState(null);
  const [textValue, setTextValue] = useState('');

  const drawRef = useRef();
  const drawingsRef = useRef(drawings);
  const requestedModeRef = useRef(requestedMode);
  const colorRef = useRef(color);
  drawingsRef.current = drawings;
  requestedModeRef.current = requestedMode;
  colorRef.current = color;

  const updateVisible = useCallback(
    (value) => {
      setVisible(value);
      window.localStorage.setItem(visibilityKey, JSON.stringify(value));
    },
    [visibilityKey],
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
      } catch (error) {
        dispatch(errorsActions.push(error.message));
        await refresh();
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
    if (!active || !visible || !editable) return undefined;
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
        new TerraDrawPointMode({ styles: { pointColor: styleColor, pointWidth: 8 } }),
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
        setPendingText({ featureId: id, existing: false });
        setTextValue('');
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
  }, [active, editable, syncEditor, visible, writeFeature]);

  useEffect(() => {
    const draw = drawRef.current;
    if (!draw?.enabled) return;
    const terraMode = drawingModes[requestedMode] || 'select';
    if (draw.getMode() !== terraMode) draw.setMode(terraMode);
    setActiveMode(requestedMode);
  }, [requestedMode]);

  const selectMode = useCallback(
    (mode) => {
      if (mode === 'text' && selectedId) {
        const feature = drawRef.current?.getSnapshotFeature(selectedId);
        if (feature?.properties.drawingType === 'text') {
          setPendingText({ featureId: selectedId, existing: true });
          setTextValue(feature.properties.text || '');
          return;
        }
      }
      setAdminDelete(false);
      setRequestedMode(mode);
      onActiveChange(true);
    },
    [onActiveChange, selectedId],
  );

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

  const deleteSelected = useCallback(async () => {
    const draw = drawRef.current;
    const feature = selectedId && draw?.getSnapshotFeature(selectedId);
    const drawingId = Number(feature?.properties.drawingId);
    if (!drawingId || !window.confirm(t('mapDrawingDeleteConfirm'))) return;
    try {
      await fetchOrThrow(`/api/drawings/${drawingId}`, { method: 'DELETE' });
      dispatch(drawingsActions.remove(drawingId));
    } catch (error) {
      dispatch(errorsActions.push(error.message));
      await refresh();
    }
  }, [dispatch, refresh, selectedId, t]);

  const deleteForeign = useCallback(
    (drawingId) => {
      if (!adminDelete) return false;
      const drawing = drawingItems[drawingId];
      if (!drawing || drawing.ownerId === user.id) return true;
      if (window.confirm(t('mapDrawingDeleteOtherConfirm'))) {
        fetchOrThrow(`/api/drawings/${drawing.id}`, { method: 'DELETE' })
          .then(() => dispatch(drawingsActions.remove(drawing.id)))
          .catch(async (error) => {
            dispatch(errorsActions.push(error.message));
            await refresh();
          });
      }
      return true;
    },
    [adminDelete, dispatch, drawingItems, refresh, t, user.id],
  );

  const saveText = useCallback(async () => {
    const draw = drawRef.current;
    const feature = pendingText && draw?.getSnapshotFeature(pendingText.featureId);
    const normalized = normalizeDrawingText(textValue).trim();
    if (!feature || !normalized) return;
    draw.updateFeatureProperties(feature.id, { text: normalized, drawingType: 'text' });
    await writeFeature(draw.getSnapshotFeature(feature.id), 'text', colorRef.current, normalized);
    setPendingText(null);
    setRequestedMode('select');
  }, [pendingText, textValue, writeFeature]);

  const cancelText = useCallback(() => {
    const draw = drawRef.current;
    if (pendingText && !pendingText.existing && draw?.hasFeature(pendingText.featureId)) {
      draw.removeFeatures([pendingText.featureId]);
    }
    setPendingText(null);
    setRequestedMode('select');
  }, [pendingText]);

  const controlsRootRef = useRef();
  useEffect(() => {
    let container;
    const control = {
      onAdd: () => {
        container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
        container.style.display = 'flex';
        container.style.flexWrap = 'wrap';
        container.style.maxWidth = '174px';
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
        editable={editable}
        administrator={user.administrator}
        activeMode={activeMode}
        selected={Boolean(selectedId)}
        color={color}
        adminDelete={adminDelete}
        onVisible={() => {
          updateVisible(!visible);
          setAdminDelete(false);
          if (visible) onActiveChange(false);
        }}
        onMode={selectMode}
        onColor={changeColor}
        onDelete={deleteSelected}
        onAdminDelete={() => {
          const next = !adminDelete;
          setAdminDelete(next);
          if (next) {
            setRequestedMode('select');
            onActiveChange(true);
          } else {
            onActiveChange(false);
          }
        }}
      />,
    );
  }, [
    activeMode,
    adminDelete,
    changeColor,
    color,
    deleteSelected,
    editable,
    onActiveChange,
    selectMode,
    selectedId,
    updateVisible,
    t,
    user.administrator,
    visible,
  ]);

  const layerDrawings =
    active && editable ? drawings.filter((drawing) => drawing.ownerId !== user.id) : drawings;

  return (
    <>
      <MapDrawingLayer drawings={layerDrawings} enabled={visible} onDrawingClick={deleteForeign} />
      <Dialog open={Boolean(pendingText)} onClose={cancelText} fullWidth maxWidth="sm">
        <DialogTitle>
          {pendingText?.existing ? t('mapDrawingEditText') : t('mapDrawingText')}
        </DialogTitle>
        <DialogContent>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelText}>{t('sharedCancel')}</Button>
          <Button onClick={saveText} disabled={!textValue.trim()}>
            {t('sharedSave')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default MapDrawing;
