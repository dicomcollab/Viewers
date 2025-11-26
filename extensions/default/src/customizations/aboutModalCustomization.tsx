import React from 'react';
import { AboutModal } from '@ohif/ui-next';

function AboutModalDefault() {
  return (
    <AboutModal className="w-[400px]">
      <AboutModal.ProductName>MedPacs</AboutModal.ProductName>

      <AboutModal.Body>
        <div className="text-muted-foreground px-4 py-2 text-sm leading-relaxed">
          MedPacs was developed primarily to aid the radiology community, and replace outdated paper-based workflows. Recognizing the challenges within this sector, we dedicated ourselves to curating an affordable, accessible, and high-quality software solution.
        </div>
        <div className="mt-4">
          <a
            href="https://med-pacs.com/about"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-active hover:text-primary-light text-sm underline"
          >
            https://med-pacs.com/about
          </a>
        </div>
      </AboutModal.Body>
    </AboutModal>
  );
}

export default {
  'ohif.aboutModal': AboutModalDefault,
};
