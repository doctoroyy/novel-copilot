
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ui } from '../../theme/tokens';
import { useAuth } from '../../contexts/AuthContext';
import { useAppConfig } from '../../contexts/AppConfigContext';
import * as api from '../../lib/api';
import type { ModelRegistry, CreditFeature } from '../../types/domain';

type Tab = 'models' | 'credit';

export function AdminScreen() {
  const navigation = useNavigation();
  const { token } = useAuth();
  const { config } = useAppConfig();
  const [activeTab, setActiveTab] = useState<Tab>('models');
  const [loading, setLoading] = useState(false);
  
  // Data State
  const [models, setModels] = useState<ModelRegistry[]>([]);
  const [creditFeatures, setCreditFeatures] = useState<CreditFeature[]>([]);

  // Modal State
  const [modelModalVisible, setModelModalVisible] = useState(false);
  const [editingModel, setEditingModel] = useState<Partial<ModelRegistry> | null>(null);

  const [creditModalVisible, setCreditModalVisible] = useState(false);
  const [editingFeature, setEditingFeature] = useState<CreditFeature | null>(null);
  const [editingCost, setEditingCost] = useState('');

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (activeTab === 'models') {
        const data = await api.fetchModelRegistry(config.apiBaseUrl, token);
        setModels(data);
      } else {
        const data = await api.fetchAdminCreditFeatures(config.apiBaseUrl, token);
        setCreditFeatures(data);
      }
    } catch (e) {
      Alert.alert('加载失败', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [activeTab, config.apiBaseUrl, token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Model Handlers
  const handleSaveModel = async () => {
    if (!token || !editingModel) return;
    try {
      // Basic validation
      if (!editingModel.provider || !editingModel.model_name || !editingModel.display_name) {
        Alert.alert('错误', '请填写完整信息');
        return;
      }
      
      const payload = {
        ...editingModel,
        credit_multiplier: Number(editingModel.credit_multiplier) || 1,
      };

      if (editingModel.id) {
        await api.updateModel(config.apiBaseUrl, token, editingModel.id, payload);
      } else {
        await api.createModel(config.apiBaseUrl, token, payload);
      }
      setModelModalVisible(false);
      setEditingModel(null);
      loadData();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message);
    }
  };

  const handleDeleteModel = (id: string, name: string) => {
    Alert.alert('确认删除', `确定要删除模型 ${name} 吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          if (!token) return;
          try {
            await api.deleteModel(config.apiBaseUrl, token, id);
            loadData();
          } catch (e) {
            Alert.alert('删除失败', (e as Error).message);
          }
        },
      },
    ]);
  };

  const handleToggleModelActive = async (model: ModelRegistry) => {
    if (!token) return;
    try {
      await api.updateModel(config.apiBaseUrl, token, model.id, { is_active: !model.is_active });
      loadData();
    } catch (e) {
      Alert.alert('操作失败', (e as Error).message);
    }
  };
  
  const handleSetDefaultModel = async (model: ModelRegistry) => {
     if (!token) return;
     try {
       await api.updateModel(config.apiBaseUrl, token, model.id, { is_default: true });
       loadData();
     } catch (e) {
       Alert.alert('操作失败', (e as Error).message);
    }
  };

  // Credit Handlers
  const handleUpdateCreditCost = async () => {
    if (!token || !editingFeature) return;
    try {
      const cost = parseInt(editingCost);
      if (isNaN(cost)) {
        Alert.alert('错误', '请输入有效的数字');
        return;
      }
      await api.updateCreditFeature(config.apiBaseUrl, token, editingFeature.key, { base_cost: cost });
      setCreditModalVisible(false);
      setEditingFeature(null);
      loadData();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message);
    }
  };

  // Render Helpers
  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color={ui.colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>管理后台</Text>
      <View style={{ width: 40 }} />
    </View>
  );

  const renderTabs = () => (
    <View style={styles.tabsContainer}>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'models' && styles.activeTab]}
        onPress={() => setActiveTab('models')}
      >
        <Text style={[styles.tabText, activeTab === 'models' && styles.activeTabText]}>模型注册</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tab, activeTab === 'credit' && styles.activeTab]}
        onPress={() => setActiveTab('credit')}
      >
        <Text style={[styles.tabText, activeTab === 'credit' && styles.activeTabText]}>能量定价</Text>
      </TouchableOpacity>
    </View>
  );

  const renderModelList = () => (
    <ScrollView style={styles.content}>
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => {
          setEditingModel({
            provider: 'openai',
            credit_multiplier: 1,
            is_active: true,
            capabilities: 'text_generation',
          });
          setModelModalVisible(true);
        }}
      >
        <Ionicons name="add" size={20} color={ui.colors.primary} />
        <Text style={styles.addButtonText}>添加新模型</Text>
      </TouchableOpacity>

      {models.map((m) => (
        <View key={m.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleRow}>
              {m.is_default && <Ionicons name="star" size={16} color="#f59e0b" style={{ marginRight: 4 }} />}
              <Text style={styles.cardTitle}>{m.display_name}</Text>
              {!m.is_active && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>已禁用</Text>
                </View>
              )}
            </View>
            <View style={styles.actionsRow}>
               {!m.is_default && (
                  <TouchableOpacity onPress={() => handleSetDefaultModel(m)} style={styles.iconBtn}>
                     <Ionicons name="star-outline" size={20} color={ui.colors.textTertiary} />
                  </TouchableOpacity>
               )}
              <TouchableOpacity onPress={() => handleToggleModelActive(m)} style={styles.iconBtn}>
                <Ionicons
                  name={m.is_active ? 'toggle' : 'toggle-outline'}
                  size={24}
                  color={m.is_active ? ui.colors.success : ui.colors.textTertiary}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                 setEditingModel(m);
                 setModelModalVisible(true);
              }} style={styles.iconBtn}>
                <Ionicons name="create-outline" size={20} color={ui.colors.text} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => handleDeleteModel(m.id, m.display_name)} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={20} color={ui.colors.danger} />
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.cardSubtitle}>{m.provider} / {m.model_name}</Text>
          <Text style={styles.cardDetail}>倍率: {m.credit_multiplier}x</Text>
        </View>
      ))}
      <View style={{ height: 40 }} />
    </ScrollView>
  );

  const renderCreditList = () => (
    <ScrollView style={styles.content}>
      {creditFeatures.map((f) => (
        <View key={f.key} style={styles.card}>
          <View style={styles.cardHeader}>
             <View style={{ flex: 1 }}>
               <Text style={styles.cardTitle}>{f.name}</Text>
               <Text style={styles.cardSubtitle}>{f.description}</Text>
             </View>
             <TouchableOpacity
               onPress={() => {
                 setEditingFeature(f);
                 setEditingCost(String(f.base_cost));
                 setCreditModalVisible(true);
               }}
               style={styles.priceTag}
             >
               <Ionicons name="flash" size={12} color={ui.colors.primary} />
               <Text style={styles.priceText}>{f.base_cost}</Text>
               <Ionicons name="pencil" size={12} color={ui.colors.primary} style={{ marginLeft: 4 }} />
             </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );

  const renderModelModal = () => (
    <Modal
      visible={modelModalVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setModelModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editingModel?.id ? '编辑模型' : '添加模型'}</Text>
            <TouchableOpacity onPress={() => setModelModalVisible(false)}>
              <Ionicons name="close" size={24} color={ui.colors.text} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            <Text style={styles.label}>显示名称</Text>
            <TextInput
              style={styles.input}
              value={editingModel?.display_name}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, display_name: t }))}
              placeholder="例如：GPT-4o"
            />
            
            <Text style={styles.label}>提供商 (Provider)</Text>
            <TextInput
              style={styles.input}
              value={editingModel?.provider}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, provider: t }))}
              placeholder="例如：openai, anthropic"
            />

            <Text style={styles.label}>模型名称 (Model Name)</Text>
            <TextInput
              style={styles.input}
              value={editingModel?.model_name}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, model_name: t }))}
              placeholder="例如：gpt-4o"
            />

            <Text style={styles.label}>能量倍率</Text>
            <TextInput
              style={styles.input}
              value={String(editingModel?.credit_multiplier ?? 1)}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, credit_multiplier: parseFloat(t) }))}
              keyboardType="numeric"
            />

            <Text style={styles.label}>API Key (可选)</Text>
            <TextInput
              style={styles.input}
              value={editingModel?.api_key}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, api_key: t }))}
              secureTextEntry
              placeholder="留空则使用全局配置"
            />

            <Text style={styles.label}>Base URL (可选)</Text>
            <TextInput
              style={styles.input}
              value={editingModel?.base_url}
              onChangeText={(t) => setEditingModel(prev => ({ ...prev, base_url: t }))}
              placeholder="https://api.example.com/v1"
            />
          </ScrollView>
          <TouchableOpacity style={styles.saveButton} onPress={handleSaveModel}>
            <Text style={styles.saveButtonText}>保存</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderCreditModal = () => (
    <Modal
      visible={creditModalVisible}
      animationType="fade"
      transparent={true}
      onRequestClose={() => setCreditModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
         <View style={[styles.modalContent, { height: 'auto', maxHeight: 300 }]}>
            <Text style={styles.modalTitle}>修改定价: {editingFeature?.name}</Text>
            <Text style={styles.label}>基础消耗</Text>
            <TextInput
              style={styles.input}
              value={editingCost}
              onChangeText={setEditingCost}
              keyboardType="numeric"
              autoFocus
            />
            <View style={styles.modalActions}>
               <TouchableOpacity 
                 style={[styles.modalBtn, { backgroundColor: ui.colors.bgMuted }]}
                 onPress={() => setCreditModalVisible(false)}
               >
                 <Text style={{ color: ui.colors.text }}>取消</Text>
               </TouchableOpacity>
               <TouchableOpacity 
                 style={[styles.modalBtn, { backgroundColor: ui.colors.primary }]}
                 onPress={handleUpdateCreditCost}
               >
                 <Text style={{ color: '#fff' }}>保存</Text>
               </TouchableOpacity>
            </View>
         </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {renderHeader()}
      {renderTabs()}
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={ui.colors.primary} />
        </View>
      ) : (
        activeTab === 'models' ? renderModelList() : renderCreditList()
      )}

      {renderModelModal()}
      {renderCreditModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ui.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: ui.colors.text,
  },
  tabsContainer: {
    flexDirection: 'row',
    padding: 12,
    gap: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: ui.radius.md,
    backgroundColor: ui.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  activeTab: {
    backgroundColor: ui.colors.primarySoft,
    borderColor: ui.colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: ui.colors.textSecondary,
  },
  activeTabText: {
    color: ui.colors.primaryStrong,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: ui.radius.md,
    borderWidth: 1,
    borderColor: ui.colors.primary, // dashed border not easy in RN without library
    borderStyle: 'dashed', 
    backgroundColor: ui.colors.surfaceWarm,
    marginBottom: 16,
  },
  addButtonText: {
    marginLeft: 8,
    color: ui.colors.primary,
    fontWeight: '600',
  },
  card: {
    backgroundColor: ui.colors.card,
    borderRadius: ui.radius.md,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: ui.colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: ui.colors.text,
    marginRight: 8,
  },
  badge: {
     backgroundColor: ui.colors.dangerSoft,
     paddingHorizontal: 6,
     paddingVertical: 2,
     borderRadius: 4,
  },
  badgeText: {
     fontSize: 10,
     color: ui.colors.danger,
     fontWeight: 'bold',
  },
  cardSubtitle: {
    fontSize: 12,
    color: ui.colors.textSecondary,
    marginBottom: 4,
  },
  cardDetail: {
     fontSize: 12,
     color: ui.colors.textTertiary,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconBtn: {
     padding: 4,
  },
  priceTag: {
     flexDirection: 'row',
     alignItems: 'center',
     backgroundColor: ui.colors.surfaceSun,
     paddingHorizontal: 8,
     paddingVertical: 4,
     borderRadius: ui.radius.sm,
     borderWidth: 1,
     borderColor: ui.colors.primaryBorder,
  },
  priceText: {
     fontSize: 14,
     fontWeight: 'bold',
     color: ui.colors.primaryStrong,
     marginLeft: 4,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: ui.colors.bg,
    borderRadius: ui.radius.lg,
    padding: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: ui.colors.border,
    paddingBottom: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: ui.colors.text,
  },
  label: {
     fontSize: 13,
     fontWeight: '600',
     color: ui.colors.textSecondary,
     marginBottom: 6,
     marginTop: 10,
  },
  input: {
     backgroundColor: ui.colors.surfaceSoft,
     borderWidth: 1,
     borderColor: ui.colors.border,
     borderRadius: ui.radius.sm,
     paddingHorizontal: 12,
     paddingVertical: 10,
     fontSize: 14,
     color: ui.colors.text,
  },
  saveButton: {
     backgroundColor: ui.colors.primary,
     borderRadius: ui.radius.md,
     padding: 14,
     alignItems: 'center',
     marginTop: 24,
  },
  saveButtonText: {
     color: '#fff',
     fontWeight: 'bold',
     fontSize: 16,
  },
  modalActions: {
     flexDirection: 'row',
     justifyContent: 'flex-end',
     gap: 12,
     marginTop: 24,
  },
  modalBtn: {
     paddingVertical: 10,
     paddingHorizontal: 16,
     borderRadius: ui.radius.sm,
  },
});
