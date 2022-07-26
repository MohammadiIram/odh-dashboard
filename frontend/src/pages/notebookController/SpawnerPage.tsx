import * as React from 'react';
import {
  ActionGroup,
  Button,
  Form,
  FormGroup,
  FormSection,
  Grid,
  GridItem,
  Select,
  SelectOption,
} from '@patternfly/react-core';
import { checkOrder, getDefaultTag, isImageTagBuildValid } from '../../utilities/imageUtils';
import {
  ImageInfo,
  ImageTag,
  VariableRow,
  ImageTagInfo,
  ConfigMap,
  Secret,
  EnvVarResourceType,
} from '../../types';
import { useSelector } from 'react-redux';
import ImageSelector from './ImageSelector';
import EnvironmentVariablesRow from './EnvironmentVariablesRow';
import { CUSTOM_VARIABLE, EMPTY_KEY, EMPTY_USER_STATE, MOUNT_PATH } from './const';
import { PlusCircleIcon } from '@patternfly/react-icons';
import { useHistory } from 'react-router';
import { createNotebook } from '../../services/notebookService';
import { createPvc, getPvc } from '../../services/pvcService';
import { State } from '../../redux/types';
import {
  generateNotebookNameFromUsername,
  generatePvcNameFromUsername,
  generateEnvVarFileNameFromUsername,
  usernameTranslate,
  verifyResource,
  checkEnvVarFile,
  generatePvc,
} from '../../utilities/notebookControllerUtils';
import AppContext from '../../app/AppContext';
import { ODH_NOTEBOOK_REPO } from '../../utilities/const';
import NotebookControllerContext from './NotebookControllerContext';
import { getGPU } from '../../services/gpuService';
import { patchDashboardConfig } from '../../services/dashboardConfigService';
import { getSecret } from '../../services/secretsService';
import { getConfigMap } from '../../services/configMapService';

import './NotebookController.scss';

type SpawnerPageProps = {
  setStartModalShown: (shown: boolean) => void;
  updateNotebook: () => void;
  setNotebookPollInterval: (interval: number) => void;
};

const SpawnerPage: React.FC<SpawnerPageProps> = React.memo(({ setStartModalShown }) => {
  const history = useHistory();
  const { images, dashboardConfig } = React.useContext(NotebookControllerContext);
  const [username, namespace] = useSelector<State, [string, string]>((state) => [
    state.appState.user || '',
    state.appState.namespace || '',
  ]);
  const projectName = ODH_NOTEBOOK_REPO || namespace;
  const translatedUsername = usernameTranslate(username);
  const { buildStatuses } = React.useContext(AppContext);
  const [selectedImageTag, setSelectedImageTag] = React.useState<ImageTag>({
    image: undefined,
    tag: undefined,
  });
  const [sizeDropdownOpen, setSizeDropdownOpen] = React.useState<boolean>(false);
  const [selectedSize, setSelectedSize] = React.useState<string>('');
  const [gpuDropdownOpen, setGpuDropdownOpen] = React.useState(false);
  const [selectedGpu, setSelectedGpu] = React.useState<string>('0');
  const [gpuSize, setGpuSize] = React.useState<number>(0);
  const [variableRows, setVariableRows] = React.useState<VariableRow[]>([]);
  const [createInProgress, setCreateInProgress] = React.useState<boolean>(false);
  const userState = React.useMemo(() => {
    if (translatedUsername) {
      const newUserState = dashboardConfig?.status?.notebookControllerState?.find(
        (state) => state.user === translatedUsername,
      );
      if (newUserState) {
        return newUserState;
      }
    }
    return EMPTY_USER_STATE;
  }, [dashboardConfig, translatedUsername]);

  React.useEffect(() => {
    let cancelled = false;
    const setGpu = async () => {
      const size = await getGPU();
      if (!cancelled) {
        setGpuSize(size);
      }
    };
    setGpu().catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    const setFirstValidImage = () => {
      const getDefaultImageTag = () => {
        let found = false;
        let i = 0;
        while (!found && i < images.length) {
          const image = images[i++];
          if (image) {
            const tag = getDefaultTag(buildStatuses, image);
            if (tag) {
              setSelectedImageTag({ image, tag });
              found = true;
            }
          }
        }
      };
      if (userState?.lastSelectedImage) {
        const [imageName, tagName] = [...userState?.lastSelectedImage.split(':')];
        const image = images.find((image) => image.name === imageName);
        const tag = image?.tags.find((tag) => tag.name === tagName);
        if (image && tag && isImageTagBuildValid(buildStatuses, image, tag)) {
          setSelectedImageTag({ image, tag });
        } else {
          getDefaultImageTag();
        }
      } else {
        getDefaultImageTag();
      }
    };
    if (images && userState) {
      setFirstValidImage();
    }
  }, [userState, images, buildStatuses]);

  React.useEffect(() => {
    if (dashboardConfig?.spec.notebookSizes) {
      if (userState?.lastSelectedSize) {
        const size = dashboardConfig.spec.notebookSizes.find(
          (notebookSize) => notebookSize.name === userState.lastSelectedSize,
        );
        if (size) {
          setSelectedSize(size.name);
        } else {
          setSelectedSize(dashboardConfig.spec.notebookSizes[0].name);
        }
      } else {
        setSelectedSize(dashboardConfig.spec.notebookSizes[0].name);
      }
    }
  }, [dashboardConfig, userState]);

  const mapRows = React.useCallback(
    async (fetchFunc: (name: string) => Promise<ConfigMap | Secret>) => {
      let fetchedVariableRows: VariableRow[] = [];
      const envVarFileName = generateEnvVarFileNameFromUsername(username);
      const response = await verifyResource(envVarFileName, fetchFunc);
      if (response && response.data) {
        const isSecret = response.kind === EnvVarResourceType.Secret;
        fetchedVariableRows = Object.entries(response.data).map(([key, value]) => {
          const errors = fetchedVariableRows.find((variableRow) =>
            variableRow.variables.find((variable) => variable.name === key),
          )
            ? { [key]: 'That name is already in use. Try a different name.' }
            : {};
          return {
            variableType: CUSTOM_VARIABLE,
            variables: [
              {
                name: key,
                value: isSecret ? Buffer.from(value, 'base64').toString() : value,
                type: isSecret ? 'password' : 'text',
              },
            ],
            errors,
          };
        });
      }
      return fetchedVariableRows;
    },
    [username],
  );

  React.useEffect(() => {
    let cancelled = false;
    const mapEnvironmentVariableRows = async () => {
      const fetchedVariableRowsConfigMap = await mapRows(getConfigMap);
      const fetchedVariableRowsSecret = await mapRows(getSecret);
      if (!cancelled) {
        setVariableRows([...fetchedVariableRowsConfigMap, ...fetchedVariableRowsSecret]);
      }
    };
    mapEnvironmentVariableRows().catch((e) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [mapRows]);

  const handleImageTagSelection = (image: ImageInfo, tag: ImageTagInfo, checked: boolean) => {
    if (checked) {
      setSelectedImageTag({ image, tag });
    }
  };

  const handleSizeSelection = (e, selection) => {
    setSelectedSize(selection);
    setSizeDropdownOpen(false);
  };

  const handleGpuSelection = (e, selection) => {
    setSelectedGpu(selection);
    setGpuDropdownOpen(false);
  };

  const sizeOptions = React.useMemo(() => {
    const sizes = dashboardConfig?.spec?.notebookSizes;
    if (!sizes?.length) {
      return [<SelectOption key="Default" value="Default" description="No Size Limits" />];
    }

    return sizes.map((size) => {
      const name = size.name;
      const desc =
        `Limits: ${size?.resources?.limits?.cpu || '??'} CPU, ` +
        `${size?.resources?.limits?.memory || '??'} Memory ` +
        `Requests: ${size?.resources?.requests?.cpu || '??'} CPU, ` +
        `${size?.resources?.requests?.memory || '??'} Memory`;
      return <SelectOption key={name} value={name} description={desc} />;
    });
  }, [dashboardConfig]);

  const gpuOptions = React.useMemo(() => {
    const values: number[] = [];
    const start = 0;
    for (let i = start; i <= gpuSize; i++) {
      values.push(i);
    }
    return values?.map((size) => <SelectOption key={size} value={`${size}`} />);
  }, [gpuSize]);

  const renderEnvironmentVariableRows = () => {
    if (!variableRows?.length) {
      return null;
    }
    return variableRows.map((row, index) => (
      <EnvironmentVariablesRow
        key={`environment-variable-row-${index}`}
        categories={[]}
        variableRow={row}
        onUpdate={(updatedRow) => onUpdateRow(index, updatedRow)}
      />
    ));
  };

  const onUpdateRow = (index: number, updatedRow?: VariableRow) => {
    const updatedRows = [...variableRows];

    if (!updatedRow) {
      updatedRows.splice(index, 1); // remove the whole variable at the index
      setVariableRows(updatedRows);
      return;
    }

    updatedRows[index] = { ...updatedRow };
    updatedRows[index].errors = {};
    for (let i = 0; i < updatedRows.length; i++) {
      if (i !== index) {
        updatedRow.variables.forEach((variable) => {
          if (updatedRows[i].variables.find((v) => v.name === variable.name)) {
            updatedRows[index].errors[variable.name] =
              'That name is already in use. Try a different name.';
          }
        });
      }
    }
    setVariableRows(updatedRows);
  };

  const addEnvironmentVariableRow = () => {
    const newRow: VariableRow = {
      variableType: CUSTOM_VARIABLE,
      variables: [
        {
          name: EMPTY_KEY,
          type: 'text',
          value: '',
        },
      ],
      errors: {},
    };
    setVariableRows([...variableRows, newRow]);
  };

  const handleNotebookAction = async () => {
    const notebookSize = dashboardConfig?.spec?.notebookSizes?.find(
      (ns) => ns.name === selectedSize,
    );
    const pvcName = generatePvcNameFromUsername(username);
    const pvcBody = generatePvc(pvcName, '20Gi');
    await verifyResource(pvcName, getPvc, createPvc, pvcBody).catch((e) =>
      console.error(`Something wrong with PVC ${pvcName}: ${e}`),
    );
    const volumes = [{ name: pvcName, persistentVolumeClaim: { claimName: pvcName } }];
    const volumeMounts = [{ mountPath: MOUNT_PATH, name: pvcName }];
    const notebookName = generateNotebookNameFromUsername(username);
    const imageUrl = `${selectedImageTag.image?.dockerImageRepo}:${selectedImageTag.tag?.name}`;
    setCreateInProgress(true);
    const envVars = await checkEnvVarFile(username, namespace, variableRows);
    await createNotebook(
      projectName,
      notebookName,
      translatedUsername,
      imageUrl,
      notebookSize,
      parseInt(selectedGpu),
      envVars,
      volumes,
      volumeMounts,
    );
    setCreateInProgress(false);
    setStartModalShown(true);
    const updatedUserState = {
      ...userState,
      lastSelectedImage: `${selectedImageTag.image?.name}:${selectedImageTag.tag?.name}`,
      lastSelectedSize: selectedSize,
    };
    const otherUsersStates = dashboardConfig?.spec.notebookControllerState?.filter(
      (state) => state.user !== translatedUsername,
    );
    const dashboardConfigPatch = {
      spec: {
        notebookControllerState: otherUsersStates
          ? [...otherUsersStates, updatedUserState]
          : [updatedUserState],
      },
    };
    await patchDashboardConfig(dashboardConfigPatch);
  };

  return (
    <>
      <Form className="odh-notebook-controller__page odh-notebook-controller__page-form">
        <FormSection title="Notebook image">
          <FormGroup fieldId="modal-notebook-image">
            <Grid sm={12} md={12} lg={12} xl={6} xl2={6} hasGutter>
              {images.sort(checkOrder).map((image) => (
                <GridItem key={image.name}>
                  <ImageSelector
                    image={image}
                    selectedImage={selectedImageTag.image}
                    selectedTag={selectedImageTag.tag}
                    handleSelection={handleImageTagSelection}
                  />
                </GridItem>
              ))}
            </Grid>
          </FormGroup>
        </FormSection>
        <FormSection title="Deployment size">
          {sizeOptions && (
            <FormGroup label="Container size" fieldId="modal-notebook-container-size">
              <Select
                isOpen={sizeDropdownOpen}
                onToggle={() => setSizeDropdownOpen(!sizeDropdownOpen)}
                aria-labelledby="container-size"
                selections={selectedSize}
                onSelect={handleSizeSelection}
                menuAppendTo="parent"
              >
                {sizeOptions}
              </Select>
            </FormGroup>
          )}
          {gpuOptions && (
            <FormGroup label="Number of GPUs" fieldId="modal-notebook-gpu-number">
              <Select
                isOpen={gpuDropdownOpen}
                onToggle={() => setGpuDropdownOpen(!gpuDropdownOpen)}
                aria-labelledby="gpu-numbers"
                selections={selectedGpu}
                onSelect={handleGpuSelection}
                menuAppendTo="parent"
              >
                {gpuOptions}
              </Select>
            </FormGroup>
          )}
        </FormSection>
        <FormSection title="Environment variables" className="odh-notebook-controller__env-var">
          {renderEnvironmentVariableRows()}
          <Button
            className="odh-notebook-controller__env-var-add-button"
            isInline
            variant="link"
            onClick={addEnvironmentVariableRow}
          >
            <PlusCircleIcon />
            {` Add more variables`}
          </Button>
        </FormSection>
        <ActionGroup>
          <Button
            variant="primary"
            onClick={() => {
              handleNotebookAction().catch((e) => {
                setCreateInProgress(false);
                setStartModalShown(false);
                console.error(e);
              });
            }}
            isDisabled={createInProgress}
          >
            Start server
          </Button>
          <Button variant="secondary" onClick={() => history.push('/')}>
            Cancel
          </Button>
        </ActionGroup>
      </Form>
    </>
  );
});

SpawnerPage.displayName = 'SpawnerPage';

export default SpawnerPage;
