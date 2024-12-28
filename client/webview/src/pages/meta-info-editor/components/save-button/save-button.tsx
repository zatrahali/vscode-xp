import { memo } from 'react';
import { usePostMessage } from '~/hooks/use-post-message';
import { useTranslations } from '~/hooks/use-translations';
import Button from '~/ui/button/button';
import Icon from '~/ui/icon/icon';
import { useActions, useEditor } from '../../store';

function SaveButton() {
  const postMessage = usePostMessage();
  const translations = useTranslations();
  const { isEditorValid } = useEditor();
  const { getData, updateAuthors, refreshUpdateDate } = useActions();

  const handleSubmit = () => {
    updateAuthors();
    refreshUpdateDate();
    postMessage({
      command: 'MetaInfoEditor.saveMetaInfo',
      payload: getData()
    });
  };

  return (
    <Button isDisabled={!isEditorValid} onClick={handleSubmit}>
      <Icon id="save" />
      {translations.Save}
    </Button>
  );
}

export default memo(SaveButton);